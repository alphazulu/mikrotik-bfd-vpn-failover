# Deployment guide

This guide assumes:

- Server1 already has a working AmneziaWG interface `<AWG_IF>`;
- Server1 can reach every configured Server2 over the public Internet;
- every Server2 can forward IPv4 traffic to the Internet;
- RouterOS 7 is used on MikroTik;
- all examples are sanitized and use placeholders.

## 1. Server2 — install packages

```bash
apt update
apt install -y wireguard bird2
```

Enable IPv4 forwarding:

```bash
cat >/etc/sysctl.d/90-vpn-router.conf <<'SYSCTL'
net.ipv4.ip_forward=1
SYSCTL
sysctl --system
```

## 2. Server2 — wg-exit

Create `/etc/wireguard/wg-exit.conf` from `configs/server2/wg-exit.conf.example`.

Important points:

- Server2 listens on `<WG_EXIT_PORT>/udp`, and the generated `wg-exit.conf` explicitly permits that UDP port in `INPUT` on `<SERVER2_WAN_IF>`.
- `AllowedIPs` for the Server1 peer includes the Server1 tunnel address plus all VPN client networks routed through Server1.
- `PostUp`/`PostDown` persist the required `FORWARD` permission for `wg-exit`;
- `PostUp`/`PostDown` also permit the public WireGuard listen port and inner single-hop BFD UDP/3784 in `INPUT`.
- The reference config also permits established return traffic to `wg-exit`.
- Source-specific `MASQUERADE` rules for VPN client networks are installed and removed with `wg-exit`.
- Optional `MTU` and `PresharedKey` values may be used; a PresharedKey must be identical on both peers.

Enable and verify:

```bash
systemctl enable --now wg-quick@wg-exit
wg show wg-exit
ip -br addr show wg-exit
ip route
```

## 3. Server2 — NAT and forwarding

The supplied `wg-exit.conf.example` is self-contained for the normal exit path: it adds forwarding rules plus source-specific `MASQUERADE` for `<AWG_NET>`. If `<WG_IN_NET>` is also used, add the matching optional NAT lines shown in the comments or use the browser configurator, which generates them automatically.

This approach avoids adding a second broad `POSTROUTING -o <SERVER2_WAN_IF> -j MASQUERADE` rule when the host already carries unrelated traffic.

## 4. Server2 — BIRD BFD responder

Create `/etc/bird/bird.conf` from `configs/server2/bird.conf.example`.

Ensure the file is readable by BIRD:

```bash
chown root:bird /etc/bird/bird.conf
chmod 640 /etc/bird/bird.conf
chmod 755 /etc/bird
bird -p -c /etc/bird/bird.conf
systemctl enable bird
systemctl restart bird
birdc show protocols
birdc show bfd sessions
```

## 5. Server1 — install packages

```bash
apt update
apt install -y wireguard bird2 conntrack
```

Enable forwarding:

```bash
cat >/etc/sysctl.d/90-vpn-router.conf <<'SYSCTL'
net.ipv4.ip_forward=1
SYSCTL
sysctl --system
```

For policy-routing deployments, avoid strict reverse-path filtering:

```bash
cat >/etc/sysctl.d/91-vpn-rpf.conf <<'SYSCTL'
net.ipv4.conf.all.rp_filter=2
net.ipv4.conf.default.rp_filter=2
SYSCTL
sysctl --system
```

## 5.1 Server1 — generated AWG 3.x

If the configurator is used in **Generate new AWG/WG configs** mode, it also creates:

```text
server1/<AWG_IF>.conf
clients/<AWG_IF>-client.conf
```

AWG 3.1 is the default generation profile.

The generated AWG file requires an AmneziaWG runtime/toolchain that understands AWG 3.x fields. Standard WireGuard `wg-quick` is not sufficient for `HeaderProtectionKey`, `ContentPaddingAddition`, `RandomTrailers`, and the other AWG-specific parameters.

Use current `amneziawg-tools` plus a compatible current `amneziawg-go` or AWG 3.1 kernel module. Do not mix a new userspace tool with an old kernel module: an old module may allow interface creation but reject the subsequent configuration.

For the AWG 3.1 profile the configurator emits:

```text
S1=S2=S3=S4=12
H1=1 H2=2 H3=3 H4=4
HeaderProtectionKey=<32-byte base64 key>
ContentPaddingAddition=10-100
RekeyAfterTime=100-120
RekeyTimeout=3-7
RejectAfterTime=150-180
KeepaliveTimeout=5-15
MaxHandshakeAttempts=15-20
RandomTrailers=on
DisableCookies=on
```

The generated client uses `PersistentKeepalive=25-35`.

See [AWG3.md](AWG3.md) for the version/compatibility rationale and validation rules.

## 6. Server1 — wg-exit interfaces

For one Server2, create `/etc/wireguard/wg-exit.conf` from `configs/server1/wg-exit.conf.example`.

For multiple Server2 nodes, create one independent WireGuard interface per exit, for example:

```text
/etc/wireguard/wg-exit.conf
/etc/wireguard/wg-exit2.conf
/etc/wireguard/wg-exit3.conf
```

Each interface must use its own transfer subnet. The configurator assigns every Server2 a numeric priority; lower values are preferred.

See [MULTI_EXIT.md](MULTI_EXIT.md) for the complete model.

Critical setting:

```ini
Table = off
```

If the imported/current WireGuard pair uses a `PresharedKey`, preserve it on both peers. If either side uses a custom `MTU`, preserve that value as well.

Enable every generated exit interface:

```bash
systemctl enable --now wg-quick@wg-exit
systemctl enable --now wg-quick@wg-exit2
# ...
```

## 7. Server1 — policy rules

Single-exit deployments keep the original rule:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
```

For multiple exits the configurator creates an ordered chain. With base table `200`:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
ip rule add priority 1001 iif <AWG_IF> lookup 201
ip rule add priority 1002 iif <AWG_IF> lookup 202
```

The Server2 with the lowest numeric priority is mapped to the first table. If that table has no BIRD default route, Linux continues to the next rule and therefore the next Server2.

Optional second incoming WireGuard:

```bash
ip rule add priority 1001 iif <WG_IN_IF> lookup 200
```

When a complete `wg-in.conf` is generated, this rule is persisted by that interface's own `PostUp`/`PreDown` hooks. If only a client subnet/interface name is supplied and no full `wg-in` configuration is generated, the policy-routing systemd unit can persist the additional rule instead.

## 8. Server1 — optional wg-in

If an additional incoming WireGuard interface is used, the configurator can generate `server1/wg-in.conf`.

The generated file contains:

- Server1 address and listen port;
- private key and peer public key;
- optional PresharedKey;
- peer AllowedIPs;
- `PostUp`/`PreDown` policy rules for the same ordered exit tables used by `awg0` (single-exit keeps priority `1001`; multi-exit uses a separate generated priority range);
- same-interface client isolation;
- forwarded client egress permission;
- established/related return forwarding.

Install it as `/etc/wireguard/<WG_IN_IF>.conf` and enable:

```bash
systemctl enable --now wg-quick@<WG_IN_IF>
```

## 9. Server1 — persistent fallback NAT

Install `configs/server1/vpn-failover-firewall.service.example` as:

```text
/etc/systemd/system/vpn-failover-firewall.service
```

The browser configurator requires the Server1 AWG `ListenPort` so it can generate the explicit WAN-side `INPUT` rule. When an incoming AWG config is imported, `ListenPort` is read automatically. If the field is filled manually, enter the actual UDP listen port used by the Server1 AWG service.

Replace placeholders and enable it:

```bash
systemctl daemon-reload
systemctl enable --now vpn-failover-firewall.service
```

The unit manages source-specific fallback `MASQUERADE` rules plus explicit Server1 `FORWARD` rules for the incoming VPN interfaces. It also installs explicit `INPUT` permissions for the public Server1 AWG listen port on `<SERVER1_WAN_IF>`, the optional `wg-in` listen port when generated, single-hop BFD UDP/3784 from MikroTik on `<AWG_IF>`, and BFD from every Server2 on the matching `wg-exit*` interface. Generated rules carry project-specific comments so the service removes only its own entries.

## 10. Server1 — BIRD

Create `/etc/bird/bird.conf` from `configs/server1/bird.conf.example` for a single exit, or use the configurator / `configs/server1/bird-multi-exit.conf.example` for multiple exits.

Each Server2 owns its own BIRD table, static BFD-controlled default, and Linux kernel table:

```text
highest priority -> exit4_1 -> table 200
next priority    -> exit4_2 -> table 201
next priority    -> exit4_3 -> table 202
```

The per-exit static route remains BIRD-2.14-compatible:

```bird
route 0.0.0.0/0 via <WG_EXIT_S2_IP> bfd;
```

Validate and inspect:

```bash
bird -p -c /etc/bird/bird.conf
birdc configure
birdc show bfd sessions
iptables -S INPUT | grep 3784
birdc show route table exit4
ip route show table 200
```

With BFD UP, table `200` should contain a default via `wg-exit`.

## 11. Server1 — conntrack event monitor

Install `configs/server1/vpn-exit-monitor.sh` as `/usr/local/sbin/vpn-exit-monitor.sh` and `configs/server1/vpn-exit-monitor.service` under `/etc/systemd/system/`.

Then:

```bash
chmod 755 /usr/local/sbin/vpn-exit-monitor.sh
systemctl daemon-reload
systemctl enable --now vpn-exit-monitor.service
journalctl -t vpn-exit-monitor -f
```

The service listens to Netlink route events using `ip monitor route` and flushes VPN conntrack only on add/delete events for the BIRD default route in table `200`.

## 12. MikroTik — BFD to Server1

Use the sanitized example in `configs/mikrotik/bfd-failover.rsc.example`.

For a `/32` tunnel address:

```routeros
/ip address
add address=<AWG_MIKROTIK_IP>/32 network=<AWG_SERVER_IP> interface=<MT_AWG_IF>
```

Before relying on BFD, the MikroTik firewall must allow the BFD control packets addressed to the router itself. The generated `.rsc` adds a narrow `chain=input protocol=udp dst-port=3784` rule constrained to `<AWG_SERVER_IP> -> <AWG_MIKROTIK_IP>` on `<MT_AWG_IF>`, and inserts it before the first existing INPUT drop rule when present.

Then choose one of the two generated MikroTik modes:

- **Address-list + mangle:** use a dedicated routing table and `check-gateway=bfd` on the monitored route. In RouterOS v7 `new-routing-mark` must reference an existing routing table, so the mark is the table name (for example `VPN`). If the BFD route becomes inactive, the mangle lookup fails and processing continues; the generated `/routing rule action=lookup routing-mark=<table> table=main` makes fallback to the normal WAN default explicit. This mode supports selective `CM_VPN`-style conntrack cleanup. Import also sets `connection-mark=no-mark` on catch-all fasttrack rules so later packets still honor the policy. If migrating from the older layout where the policy table itself also contains a backup default (for example `distance=2` via the normal WAN gateway), remove or disable that backup route after adding the fallback rule; otherwise the policy-table lookup succeeds on that route and never reaches the `main` fallback rule.
- **Direct routes:** add the required destination prefixes directly to `main`, each through the AWG gateway with `check-gateway=bfd`. No mangle or connection marks are generated.

In direct-route mode, existing connections are not selectively flushed by the generated MikroTik script because no connection mark exists.

## 13. Functional test

For a single exit, the original test remains valid.

For multiple exits, inspect:

```bash
birdc show bfd sessions
ip rule
ip route show table 200
ip route show table 201
ip route show table 202
journalctl -t vpn-exit-monitor -f
```

Then stop `wg-exit` on the currently preferred Server2. Expected behavior:

1. that exit's BFD session goes DOWN;
2. only its Linux table loses the BIRD default;
3. policy routing selects the next available Server2 table;
4. VPN conntrack is flushed because the effective path changed;
5. when the more preferred Server2 returns, automatic failback occurs.

Repeat until every Server2 is unavailable; the final fallback must be Server1's `main` table and WAN.

Detailed test procedure: [MULTI_EXIT.md](MULTI_EXIT.md).
