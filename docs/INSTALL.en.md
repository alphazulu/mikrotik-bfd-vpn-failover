# Deployment guide

[Русская версия](INSTALL.md)

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

After installing compatible AmneziaWG tools and reviewing the generated file, place `server1/<AWG_IF>.conf` at `/etc/amnezia/amneziawg/<AWG_IF>.conf`, restrict it to mode 600, then enable `awg-quick@<AWG_IF>`. The generated `INSTALL.txt` includes these commands. Existing imported AWG deployments keep their current service lifecycle.

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

See [AWG3.en.md](AWG3.en.md) for the version/compatibility rationale and validation rules.

## 6. Server1 — wg-exit interfaces

For one Server2, create `/etc/wireguard/wg-exit.conf` from `configs/server1/wg-exit.conf.example`.

For multiple Server2 nodes, create one independent WireGuard interface per exit, for example:

```text
/etc/wireguard/wg-exit.conf
/etc/wireguard/wg-exit2.conf
/etc/wireguard/wg-exit3.conf
```

Each interface must use its own transfer subnet. The configurator assigns every Server2 a numeric priority; lower values are preferred.

See [MULTI_EXIT.en.md](MULTI_EXIT.en.md) for the complete model.

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

## 6.1 Generate inter-server WireGuard instead of importing

The browser configurator has an independent **Inter-server WG source** selector.

Choose **Generate Server1 ↔ Server2 wg-exit configs** to create the inter-server WireGuard material locally without importing existing `wg-exit.conf` files.

For each exit the configurator generates:

- a Server1 X25519 private/public key pair;
- a Server2 X25519 private/public key pair;
- an optional unique PresharedKey for that tunnel;
- a separate `/30` transfer subnet when the address fields are empty.

The public endpoint of each Server2 is not guessed and must be entered explicitly. Priority, UDP port, WAN interface, MTU and interface name remain editable.

The same operation supports the primary Server2 and every additional Server2. Generated outputs are installed exactly like imported ones:

```text
server1/wg-exit.conf
server1/wg-exit2.conf
...
server2/wg-exit.conf
server2-2/wg-exit.conf
...
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

The unit manages source-specific fallback `MASQUERADE` and `FORWARD` rules. Its narrow `INPUT` rules permit AWG, optional `wg-in`, BFD UDP/3784 from MikroTik and each Server2, and BGP TCP/179 from MikroTik inside `<AWG_IF>`. Project-specific comments let the unit remove only its own entries.

## 10. Server1 — BIRD

Create `/etc/bird/bird.conf` from `configs/server1/bird.conf.example` for one exit, or use the configurator / `configs/server1/bird-multi-exit.conf.example` for multiple exits. Server1 and MikroTik need distinct private ASNs (defaults 65001 and 65010). BIRD advertises the selected prefix to MikroTik from a separate `mt_advertised` table with no kernel export. This announcement continues while Server1 is available, including when every Server2 is down.

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

Check `birdc show protocols bgp_mt` for the MikroTik session. The Server2 BFD routes in tables 200+ remain independent.

## 11. Server1 — conntrack event monitor

Install `configs/server1/vpn-exit-monitor.sh` as `/usr/local/sbin/vpn-exit-monitor.sh` and `configs/server1/vpn-exit-monitor.service` under `/etc/systemd/system/`.

Then:

```bash
chmod 755 /usr/local/sbin/vpn-exit-monitor.sh
systemctl daemon-reload
systemctl enable --now vpn-exit-monitor.service
journalctl -t vpn-exit-monitor -f
```

The service listens to Netlink route events using `ip monitor route`, computes the currently selected exit across priority-ordered tables, and flushes VPN conntrack only when that selected path changes.

### RouterOS policy-routing fallback prerequisites

For address-list + mangle mode, the generated RouterOS configuration assumes the current default routing-decision order:

```text
mangle -> vrf-lookup -> vrf-unreach -> local -> user -> main
```

The dedicated table (for example `VPN`) is created with `fib` before `new-routing-mark` references it. It should contain only the selected BGP prefix. When BFD tears down the BGP session, that prefix is withdrawn and policy processing continues to the explicit fallback:

```routeros
/routing rule
add action=lookup routing-mark=VPN table=main comment="VPN_BFD_FALLBACK"
```

Do not change this fallback to `lookup-only-in-table`. Also remove any legacy backup default from the policy table itself, for example a `distance=2` route to the normal WAN gateway, because such a route makes the marked lookup succeed and prevents fallback to `main`.

If the router has a customized `/routing/settings policy-rules`, check it before deployment. The generated design requires `mangle` to be evaluated before `user/main`, and `main` must remain available as the final forwarding table.

## 12. MikroTik — BGP and BFD to Server1

Use the sanitized example in `configs/mikrotik/bfd-failover.rsc.example`.

For a `/32` tunnel address:

```routeros
/ip address
add address=<AWG_MIKROTIK_IP>/32 network=<AWG_SERVER_IP> interface=<MT_AWG_IF>
```

RouterOS 7.20+ is required. MikroTik INPUT must accept BFD UDP/3784 and BGP TCP/179 on the AWG link from the exact peer address. The generated `.rsc` inserts narrow rules before the first existing INPUT drop. BGP uses distinct private ASNs, `use-bfd=yes`, an inbound prefix allowlist, and an outbound reject-all filter.

Then choose one of the two generated MikroTik modes:

- **Address-list + mangle:** the dedicated table receives a BGP prefix, and `new-routing-mark` references that table (for example `VPN`). When BGP withdraws it, `/routing rule action=lookup routing-mark=<table> table=main` provides fallback. The watcher tracks the active dynamic route and selectively clears `CM_VPN` conntrack. Catch-all fasttrack rules are limited to `connection-mark=no-mark`.
- **Direct routes:** the configurator accepts DNS server IPs (without prefixes) and arbitrary IPv4/CIDR destinations separately. BGP installs them in `main` over AWG, using `/32` for DNS servers; `/ip dns` settings are unchanged. Routes disappear when BFD goes down. A requested `/0` becomes two `/1` prefixes to outrank the normal WAN default while the tunnel is available.

In direct-route mode, existing connections are not selectively flushed by the generated MikroTik script because no connection mark exists.

For migration, the `.rsc` removes only former generator routes commented `VPN_BFD_PRIMARY` or `VPN_BFD_DIRECT` and replaces its watcher. Manually remove any unrelated backup WAN default inside `VPN`. Verify selected BGP names and ASNs do not conflict with existing configuration; do not duplicate an existing AWG address or BFD configuration. Install Server1 BIRD and its TCP/179 allow rule before importing the MikroTik script. Then check `/routing bgp session print detail`, `/routing bfd session print detail`, and the dynamic route in the selected table.

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

Detailed test procedure: [MULTI_EXIT.en.md](MULTI_EXIT.en.md).
