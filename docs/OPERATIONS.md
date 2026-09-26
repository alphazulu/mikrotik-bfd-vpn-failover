# Operations, testing and troubleshooting

## Daily health checks

### Server1

```bash
wg show wg-exit
birdc show bfd sessions
ip rule
ip route show table 200
systemctl is-active wg-quick@wg-exit bird vpn-exit-monitor
```

### Server2

```bash
wg show wg-exit
birdc show bfd sessions
sysctl net.ipv4.ip_forward
iptables -S FORWARD
iptables -t nat -S POSTROUTING
```

### MikroTik

```routeros
/routing bfd session print detail
/ip route print detail where check-gateway=bfd
```

## Expected route events on Server1

When Server2 disappears:

```text
Deleted default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird metric 32
```

When Server2 returns:

```text
default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird metric 32
```

Observe manually:

```bash
ip -ts monitor route
journalctl -t vpn-exit-monitor -f
```

## BFD diagnostics

```bash
birdc show bfd sessions
tcpdump -ni wg-exit -vvv udp port 3784
tcpdump -ni <AWG_IF> -vvv udp port 3784
```

Single-hop BFD packets should normally use TTL 255.

## WireGuard diagnostics

```bash
wg show wg-exit
```

Check latest handshake, transfer counters, endpoint and AllowedIPs. A WireGuard interface can remain administratively UP even when its peer is unreachable; BFD provides liveness.

## Firewall persistence

If Server2 has `FORWARD` policy DROP, keep:

```ini
PostUp = iptables -I FORWARD 1 -i %i -j ACCEPT
PostDown = iptables -D FORWARD -i %i -j ACCEPT
```

in `wg-exit.conf`.

## Reboot test matrix

Test:

1. Server1 only;
2. Server2 only;
3. both in the same maintenance window;
4. Server1 while Server2 remains offline;
5. Server2 later, confirming automatic failback.

After each test:

```bash
birdc show bfd sessions
ip route show table 200
```

## Conntrack cleanup

Server1 removes only connections sourced from configured VPN client subnets.

MikroTik removes only connections marked `CM_VPN`.

## MTU / PMTU

If ICMP works but HTTPS/TCP sessions stall, investigate PMTU/MSS:

```bash
ping -M do -s <SIZE> <REMOTE_IP>
tracepath <REMOTE_IP>
```

## BFD timers

Recommended starting point:

```text
500 ms transmit/receive
multiplier 3
```

Do not make timers more aggressive unless measurements justify it.
