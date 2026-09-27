# Operations, testing and troubleshooting

## Daily health checks

### Server1

```bash
wg show
birdc show bfd sessions
ip rule
ip route show table 200
# for additional exits:
ip route show table 201
ip route show table 202
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

## Health-check design note

Do not replace the generated per-exit BFD checks with recursive routes to an arbitrary public probe host unless the network topology changes.

Current project assumption:

```text
MikroTik -> Internet -> Server1
Server1  -> Internet -> each Server2 public WireGuard endpoint
```

Because the real tunnel endpoints themselves are reached through the Internet, BFD tests the actual path that must be alive for the VPN exit to work. Recursive probes would add another failure domain rather than improve the signal for this deployment.

If a future design introduces a private underlay to Server2, or requires explicit validation of NAT/public-destination reachability beyond the tunnel endpoint, add a separate end-to-end health check and document the new failure criterion.

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


## Multi-exit failover test

For multiple Server2 exits, verify the complete priority chain rather than only primary-to-main fallback.

Example with three exits:

```text
table 200 -> priority 1
table 201 -> priority 2
table 202 -> priority 3
main      -> Server1 WAN
```

Check the current state:

```bash
birdc show bfd sessions
ip rule
ip route show table 200
ip route show table 201
ip route show table 202
journalctl -t vpn-exit-monitor -f
```

Then stop `wg-exit` on the most preferred Server2. New sessions should move to the next table. Continue until all Server2 exits are down and confirm fallback through Server1 WAN.

Restore the Server2 nodes in a non-priority order as well. The selected path must always converge to the lowest numeric priority currently available.

A backup Server2 going DOWN/UP while a higher-priority exit remains active should not produce a `Selected VPN exit changed` log entry and should not flush VPN conntrack.


## RouterOS 7.24.x scheduler note

The generated `VPN-BFD-Conntrack` watcher intentionally does not use a bare `:return`.

On RouterOS 7.24.x, `:return` requires a value. A bare `:return` in a scheduler-run script can log:

```text
Script Error: missing value(s) of argument(s) value
```

The watcher therefore uses nested `:if ... else={...}` blocks for early-exit logic instead of `:return`. Initial state is recorded without flushing conntrack, and later runs flush only when the monitored route state actually changes.
