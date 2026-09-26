# Multiple Server2 exits and prioritized failover

The project supports multiple exit Server2 nodes at the same time.

Server1 creates a **separate WireGuard interface for each Server2**:

```text
MikroTik / VPN clients
        |
        v
      Server1
        |
        +-- wg-exit  ----> Server2-A   priority 10
        |
        +-- wg-exit2 ----> Server2-B   priority 20
        |
        +-- wg-exit3 ----> Server2-C   priority 30
        |
        +---------------> Server1 WAN / main
```

A lower numeric priority means a more preferred exit.

## Why every Server2 gets a separate WireGuard interface

Each exit peer needs to accept `AllowedIPs = 0.0.0.0/0` on Server1.

Multiple peers claiming the same `0.0.0.0/0` on one WireGuard interface do not provide an unambiguous peer selection for outgoing packets. The project therefore uses one interface per exit:

```text
wg-exit
wg-exit2
wg-exit3
...
```

Every interface also uses its own point-to-point transfer subnet.

## Priority mapping

Example:

| Server2 | Priority | Server1 interface |
|---|---:|---|
| Server2-A | 10 | `wg-exit` |
| Server2-B | 20 | `wg-exit2` |
| Server2-C | 30 | `wg-exit3` |

With Linux base routing table `200`, the configurator assigns:

```text
priority 10 -> table 200
priority 20 -> table 201
priority 30 -> table 202
```

Priority values can be any positive integers. Only their ordering matters. Duplicate priorities are rejected.

## Linux policy routing

For `awg0`, Server1 receives ordered rules such as:

```bash
ip rule add priority 1000 iif awg0 lookup 200
ip rule add priority 1001 iif awg0 lookup 201
ip rule add priority 1002 iif awg0 lookup 202
```

If table `200` has no route, Linux continues with table `201`, then `202`, and finally the normal `main` table when all Server2 exits are unavailable.

The optional `wg-in` interface receives the same exit order using a separate rule-priority range.

## BIRD

Each Server2 has its own BIRD IPv4 table and its own Linux kernel table on Server1:

```text
exit4_1 -> Linux table 200 -> wg-exit
exit4_2 -> Linux table 201 -> wg-exit2
exit4_3 -> Linux table 202 -> wg-exit3
```

Every default route is BFD-controlled, so each exit can independently appear or disappear without affecting the other tables.

## Conntrack

The route monitor tracks the **selected exit**, not every BIRD event.

It flushes VPN-client conntrack only when the effective path actually changes, for example:

```text
Server2-A -> Server2-B
Server2-B -> Server2-C
Server2-C -> main
main      -> Server2-A
```

A lower-priority backup flapping while the primary remains healthy does not trigger a conntrack flush.

## Failback

Failback follows the same priority ordering. When a more preferred Server2 becomes available again, its table is selected first and new traffic automatically returns to it.

## All Server2 exits unavailable

When none of the dedicated tables contains a BIRD default route, Linux continues policy lookup into `main`, so Server1 WAN remains the final fallback.

## Per-exit requirements

Every additional Server2 needs:

- a unique priority;
- a unique Server1 WireGuard interface name;
- a distinct transfer subnet;
- Server1 and Server2 tunnel addresses;
- Server2 public endpoint;
- UDP port;
- WireGuard keys for both sides;
- optional PresharedKey;
- Server2 WAN interface;
- optional MTU.

The configurator can import both Server1-side and Server2-side WireGuard configs for every additional exit.

## Generated layout

Two exits produce a structure similar to:

```text
server1/
  wg-exit.conf
  wg-exit2.conf
  bird.conf
  awg-policy-routing.service
  vpn-exit-monitor.sh
  vpn-exit-monitor.service
  ...

server2/
  wg-exit.conf
  bird.conf

server2-2/
  wg-exit.conf
  bird.conf
```

## Verification

For three exits:

```bash
birdc show bfd sessions
ip rule
ip route show table 200
ip route show table 201
ip route show table 202
journalctl -t vpn-exit-monitor -f
```

Test each failure stage in order, then restore the exits and confirm that the system automatically returns to the most preferred available Server2.
