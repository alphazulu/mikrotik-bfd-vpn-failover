# Architecture

## 1. Routing model

Server1 has an ordered set of Internet exits for VPN client traffic:

1. one or more Server2 nodes, each reached through its own WireGuard interface;
2. final fallback through Server1's normal WAN and `main` routing table.

Every Server2 has a unique numeric priority. Lower values are preferred.

The key mechanism is Linux policy routing. With one exit:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
```

With three prioritized exits the configurator generates an ordered chain:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
ip rule add priority 1001 iif <AWG_IF> lookup 201
ip rule add priority 1002 iif <AWG_IF> lookup 202
```

The highest-priority Server2 owns the first table, the next Server2 owns the next table, and so on.

An optional second incoming WireGuard interface uses the same ordered exit tables. In a single-exit topology the historical form remains:

```bash
ip rule add priority 1001 iif <WG_IN_IF> lookup 200
```

In a multi-exit topology the generated `wg-in.conf` owns a separate ordered rule range, for example:

```bash
ip rule add priority 2000 iif <WG_IN_IF> lookup 200
ip rule add priority 2001 iif <WG_IN_IF> lookup 201
ip rule add priority 2002 iif <WG_IN_IF> lookup 202
```

These rules are installed and removed by `PostUp`/`PreDown`.

Linux policy rules are evaluated in order. If one table does not contain a matching route, lookup continues to the next rule.

For example:

```text
table 200 has default -> Server2-A
table 200 empty       -> try table 201
table 201 has default -> Server2-B
table 201 empty       -> try table 202
all exit tables empty -> main -> Server1 WAN
```

This means Server1 does not need to rewrite one route's gateway during failover. Each Server2 owns its own table and BFD only adds/removes that exit's default route.

## 2. BFD and BIRD

### Design assumption: the tunnel path itself traverses the Internet

Server1 and every Server2 are Internet-reachable hosts, and every `wg-exit*` is established to the public Internet endpoint of its Server2. There is no separate private underlay that could keep BFD alive while the public path used to reach that server is down.

Therefore, in this project's topology, BFD is intentionally used as the exit liveness signal. A BFD UP state proves reachability over the actual Internet/WireGuard path to that Server2 plus the local tunnel/firewall/BIRD path required for forwarding. If the Internet path to that Server2 fails, the WireGuard transport cannot carry BFD and BIRD withdraws only that exit's default route.

The project deliberately does **not** generate recursive routes to an unrelated public probe address as the primary health check. Such a probe would add a third-party dependency and would test a different path from the actual Server1 ↔ Server2 tunnel. This is a topology-specific design decision, not a general claim that BFD validates arbitrary Internet destinations or NAT.

BFD runs independently across every Server1 ↔ Server2 WireGuard interface. BIRD on Server1 owns one static default route per exit, each with the `bfd` attribute and its own BIRD/Linux routing table.

Conceptually for each exit:

```text
BFD session UP
    -> that exit's static default route is valid
    -> its kernel protocol exports the route to its Linux table

BFD session DOWN
    -> only that exit's route is withdrawn
    -> policy lookup automatically continues to the next table
```

The configurator deliberately uses one WireGuard interface per Server2. This avoids ambiguous peer selection when multiple exit peers would otherwise claim the same `AllowedIPs = 0.0.0.0/0` on one interface.

Recommended BFD timers:

```text
minimum transmit: 500 ms
minimum receive:  500 ms
multiplier:       3
```

This normally detects a complete failure in roughly 1.5 seconds.

## BFD firewall path

BFD packets terminate on the local routing process/router and therefore traverse the host/router `INPUT` chain, not `FORWARD`.

This project uses direct/single-hop BFD only:

```text
MikroTik -> Server1 awg0       UDP dst 3784
Server1  -> MikroTik           UDP dst 3784
Server1  <-> each Server2      UDP dst 3784 inside wg-exit*
```

The generated firewall rules are deliberately narrow:

- exact tunnel interface;
- exact peer source address;
- exact local destination address;
- UDP destination port 3784.

On Server2, the generated `wg-exit.conf` also permits the public WireGuard listen UDP port on the configured WAN interface. This is separate from BFD: WireGuard transport is outer/public traffic, while BFD/3784 is inner tunnel traffic delivered to BIRD.

## 3. NAT behavior

### Preferred path

```text
VPN client private address
    -> Server1
    -> wg-exit
    -> Server2
    -> MASQUERADE on Server2 WAN
    -> Internet
```

Server1 does not NAT traffic between the incoming VPN and `wg-exit`.

On Server2 the generated/reference configuration installs source-specific `MASQUERADE` rules for the VPN client subnets and permits established return traffic back into `wg-exit`. These rules are tied to `wg-exit` lifecycle with `PostUp`/`PostDown`, so they survive normal service restarts without relying on a manually entered transient iptables rule.

### Fallback path

When Server2 becomes unavailable, the same traffic leaves Server1 directly through its WAN. Server1 therefore needs source NAT for the VPN client subnet(s) on its WAN interface.

The project supplies a oneshot systemd unit, `vpn-failover-firewall.service`, which adds source-specific fallback `MASQUERADE` rules on start and removes only its own commented rules on stop. The same unit also installs explicit Server1 forwarding rules for incoming VPN interfaces: forwarded traffic from each VPN interface is permitted, established/related return traffic is allowed back to that interface, and same-interface hairpin forwarding is dropped. This keeps the generated setup usable with restrictive FORWARD policies without flushing or replacing unrelated firewall state.

## 4. Conntrack behavior

Changing a route does not automatically rebuild existing connection tracking and NAT state. Therefore both failover and failback explicitly clear conntrack entries for VPN client subnets.

On Server1 this is done by a Netlink-driven monitor. In a multi-exit deployment it calculates the actually selected exit (the first priority-ordered table that currently contains a BIRD default route) and flushes VPN conntrack only when that selected exit changes. A backup route flapping while a more preferred route remains active does not trigger cleanup.

On MikroTik existing connections are already marked `CM_VPN`, so the router removes only:

```routeros
/ip firewall connection remove [find where connection-mark="CM_VPN"]
```

The cleanup is performed only on an actual route state transition.

## 5. MikroTik-side BFD

MikroTik can independently monitor Server1 through BFD inside the AmneziaWG tunnel.

For a point-to-point address configured as `/32`, use the remote tunnel address as the `network` value:

```routeros
/ip address
add address=<AWG_MIKROTIK_IP>/32 network=<AWG_SERVER_IP> interface=<MT_AWG_IF>
```

This is important for correct single-hop BFD behavior and source address selection.

## 6. Failure domains

The design handles two separate failures:

### Server1 ↔ Server2 failure

Handled on Server1 by BFD/BIRD and policy routing.

### MikroTik ↔ Server1 failure

Handled on MikroTik by its own BFD session and `check-gateway=bfd` route monitoring.

The two mechanisms are independent.


## 7. MikroTik routing modes

Two MikroTik routing models are supported.

### Address-list + mangle mode

The failover route lives in a dedicated RouterOS routing table. The configurator ensures that the table exists, creates a BFD-monitored route inside it, and generates `mark-connection` rules for the selected destination address lists.

RouterOS v7 requires `new-routing-mark` to reference an existing routing table, so mangle uses the actual table name (for example `VPN`):

```routeros
/ip firewall mangle
add action=mark-routing chain=prerouting connection-mark=CM_VPN new-routing-mark=VPN
```

With the default RouterOS policy order, the mangle lookup is evaluated before user routing rules. If the BFD route in `VPN` is inactive and no route matches, that lookup fails and RouterOS continues to the next policy rule. The configurator adds one explicit user rule to make the fallback to `main` obvious:

```routeros
/routing rule
add action=lookup routing-mark=VPN table=main comment="VPN_BFD_FALLBACK"
```

No synthetic `VPN_RM` table/mark is needed.

Packets to the router itself are excluded with `dst-address-type=!local`, and traffic arriving on the WAN interface list is not marked.

Fasttrack bypasses mangle after the first packet, which would drop the routing mark. The generated import limits existing catch-all fasttrack rules (`connection-mark` unset) to `connection-mark=no-mark`. Rules that already match a specific mark are not modified.

The address-list contents themselves are not generated because they are deployment-specific policy data.

Because connections are marked, the MikroTik failover script can selectively remove only those connections on route state changes.

If the configured routing table is `main`, no extra routing rules are emitted: the BFD route and the normal default already share one table, so an inactive BFD route yields to the remaining default.

### Direct-route mode

No policy-routing marks are used. The configurator accepts one or more IPv4/CIDR destinations and creates static routes directly in `main` through the Server1 AWG gateway with `check-gateway=bfd`.

When the BFD session is DOWN, those specific routes become inactive and normal RouterOS longest-prefix routing falls back to other matching routes, usually the regular Internet default route.

This mode intentionally does not generate mangle rules, connection marks, or selective MikroTik conntrack cleanup. It is simpler and works well when the set of destinations can be expressed directly as routes.


## 8. Multi-exit details

See also: [Multiple Server2 exits and prioritized failover](MULTI_EXIT.md) and the [Russian version](MULTI_EXIT.ru.md).
