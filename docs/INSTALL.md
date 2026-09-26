# Deployment guide

This guide assumes:

- Server1 already has a working AmneziaWG interface `<AWG_IF>`;
- Server1 can reach Server2 over the public Internet;
- Server2 can forward IPv4 traffic to the Internet;
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

- Server2 listens on `<WG_EXIT_PORT>/udp`.
- `AllowedIPs` for the Server1 peer includes the Server1 tunnel address plus all VPN client networks routed through Server1.
- `PostUp`/`PostDown` persist the required `FORWARD` permission for `wg-exit`.
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

## 6. Server1 — wg-exit

Create `/etc/wireguard/wg-exit.conf` from `configs/server1/wg-exit.conf.example`.

Critical setting:

```ini
Table = off
```

If the imported/current WireGuard pair uses a `PresharedKey`, preserve it on both peers. If either side uses a custom `MTU`, preserve that value as well.

Enable:

```bash
systemctl enable --now wg-quick@wg-exit
```

## 7. Server1 — policy rules

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
```

Optional second incoming WireGuard:

```bash
ip rule add priority 1001 iif <WG_IN_IF> lookup 200
```

Persist the rules using the supplied systemd example or another local network configuration mechanism.

## 8. Server1 — persistent fallback NAT

Install `configs/server1/vpn-failover-firewall.service.example` as:

```text
/etc/systemd/system/vpn-failover-firewall.service
```

Replace placeholders and enable it:

```bash
systemctl daemon-reload
systemctl enable --now vpn-failover-firewall.service
```

The unit manages only source-specific fallback `MASQUERADE` rules for VPN client networks.

## 9. Server1 — BIRD

Create `/etc/bird/bird.conf` from `configs/server1/bird.conf.example`.

Key route:

```bird
route 0.0.0.0/0 via <WG_EXIT_S2_IP> dev "wg-exit" bfd;
```

Validate and inspect:

```bash
bird -p -c /etc/bird/bird.conf
birdc configure
birdc show bfd sessions
birdc show route table exit4
ip route show table 200
```

With BFD UP, table `200` should contain a default via `wg-exit`.

## 10. Server1 — conntrack event monitor

Install `configs/server1/vpn-exit-monitor.sh` as `/usr/local/sbin/vpn-exit-monitor.sh` and `configs/server1/vpn-exit-monitor.service` under `/etc/systemd/system/`.

Then:

```bash
chmod 755 /usr/local/sbin/vpn-exit-monitor.sh
systemctl daemon-reload
systemctl enable --now vpn-exit-monitor.service
journalctl -t vpn-exit-monitor -f
```

The service listens to Netlink route events using `ip monitor route` and flushes VPN conntrack only on add/delete events for the BIRD default route in table `200`.

## 11. MikroTik — BFD to Server1

Use the sanitized example in `configs/mikrotik/bfd-failover.rsc.example`.

For a `/32` tunnel address:

```routeros
/ip address
add address=<AWG_MIKROTIK_IP>/32 network=<AWG_SERVER_IP> interface=<MT_AWG_IF>
```

Then enable BFD and use `check-gateway=bfd` on the monitored route.

## 12. Functional test

Normal state:

- BFD Server1 ↔ Server2 is UP.
- `ip route show table 200` contains a default through `wg-exit`.
- VPN clients exit through Server2.

Failover test on Server2:

```bash
systemctl stop wg-quick@wg-exit
```

Expected: BFD DOWN, route removed from table 200, conntrack flushed, new traffic exits through Server1.

Failback:

```bash
systemctl start wg-quick@wg-exit
```

Expected: BFD UP, route restored, conntrack flushed again, new traffic returns to Server2.
