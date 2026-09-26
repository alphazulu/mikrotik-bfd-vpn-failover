# Architecture

## 1. Routing model

Server1 has two possible Internet exits for VPN client traffic:

1. preferred path through Server2 using `wg-exit`;
2. fallback path through Server1's normal WAN and `main` routing table.

The key mechanism is Linux policy routing:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
```

An optional second incoming WireGuard interface can use the same table with another priority:

```bash
ip rule add priority 1001 iif <WG_IN_IF> lookup 200
```

For a fully generated `wg-in.conf`, that priority-1001 rule is owned by the interface lifecycle itself through `PostUp`/`PreDown`. This matches the tested deployment model and guarantees that the rule appears when `wg-in` is started at boot and is removed when the interface is stopped.

Linux policy rules are evaluated in order. If table `200` does not contain a matching route, lookup continues to the next rule, normally `main`.

Therefore:

```text
BFD UP
  table 200 contains default -> wg-exit -> Server2

BFD DOWN
  table 200 has no default -> lookup continues -> main -> Server1 WAN
```

## 2. BFD and BIRD

BFD runs across `wg-exit` between Server1 and Server2. BIRD on Server1 owns a static default route with the `bfd` attribute.

Conceptually:

```text
BFD session UP
    -> static default route is valid
    -> kernel protocol exports it to Linux table 200

BFD session DOWN
    -> static route is withdrawn
    -> Linux table 200 loses its default route
```

Recommended BFD timers:

```text
minimum transmit: 500 ms
minimum receive:  500 ms
multiplier:       3
```

This normally detects a complete failure in roughly 1.5 seconds.

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

On Server1 this is done by a Netlink-driven monitor which watches BIRD's route add/delete events.

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


## 7. MikroTik policy routing

The failover route may live in a dedicated RouterOS routing table rather than `main`.

When a custom table is selected, the configurator first ensures that the table exists under `/routing table`, then creates the BFD-monitored default route inside it.

Optionally, one or more existing destination address lists can be supplied. For each list the configurator generates a `mark-connection` rule that assigns the configured connection mark (for example `CM_VPN`). A single `mark-routing` rule then sends those marked connections into the selected routing table while excluding traffic arriving from the configured WAN interface list.

The address-list contents themselves are not generated, because they are deployment-specific policy data rather than part of the failover transport topology.
