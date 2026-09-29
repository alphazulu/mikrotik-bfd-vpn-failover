# MikroTik → AmneziaWG → Ubuntu → WireGuard Exit with BFD Failover

[Русская версия](README.md)

This repository documents a resilient multi-stage VPN routing design. The basic topology uses one Server2; the extended topology supports multiple prioritized Server2 exits:

```text
MikroTik
   │
   │ AmneziaWG + BFD
   ▼
Server1
   ├──────────── fallback ────────────► Internet
   │             via eth0
   │
   └─ table 200 ─► wg-exit ─► Server2 ─► Internet
                    BFD          NAT
```

The preferred path goes through the highest-priority available Server2. If that exit fails, **BFD + BIRD** remove its default route and Linux policy routing tries the next Server2. If all Server2 exits are unavailable, lookup falls through to Server1's normal `main` table. When a more preferred exit returns, failback is automatic.

On every **UP → DOWN** and **DOWN → UP** transition, only VPN-client conntrack state is cleared, so stale NAT/connection state does not delay failover or failback.

> This repository intentionally contains no real public IP addresses, private keys, passwords, tokens, production hostnames or other identifying infrastructure data. Placeholders are used instead.

## Features

- incoming AmneziaWG tunnel on Server1;
- optional additional incoming WireGuard interface;
- one or more independent inter-server WireGuard exits (`wg-exit`, `wg-exit2`, ...);
- independent BFD between Server1 and every Server2;
- explicit firewall INPUT rules for all server-side VPN listener ports (Server1 AWG, optional wg-in, every Server2 wg-exit) and single-hop BFD UDP/3784;
- BIRD 2.x for automatic default-route installation/removal;
- ordered Linux policy routing through tables `200`, `201`, `202`, ... based on Server2 priority;
- automatic failover Server2 → next Server2 → Server1 WAN;
- automatic failback to the most preferred available Server2;
- event-driven Linux conntrack cleanup from Netlink route events;
- BFD between MikroTik and Server1 inside AmneziaWG;
- BGP `use-bfd=yes` between MikroTik and Server1 instead of static-route BFD;
- cleanup only for connections marked `CM_VPN` when route state changes;
- persistence across Server1/Server2 reboots.

## Online configurator

The project now includes a local browser-based configurator:

**https://alphazulu.github.io/mikrotik-bfd-vpn-failover/**

It can:

- independently choose the source for incoming AWG/wg-in and inter-server `wg-exit`: import existing `.conf` files or generate locally;
- import `wg-exit` configurations for Server1 and Server2;
- add additional Server2 exits, assign a priority and dedicated Server1 WireGuard interface, and import both sides of each tunnel;
- optionally import the incoming AWG Server1 configuration and a separate `wg-in.conf`;
- extract internal tunnel IPs, endpoint, UDP port, WireGuard keys, optional `PresharedKey` and MTU;
- validate that Server1 and Server2 are in the same wg-exit subnet;
- validate client subnet and BFD parameters;
- generate ready-to-use Server1, Server2 and MikroTik configurations;
- generate an optional `server1/wg-in.conf` with its own `PostUp`/`PreDown` policy-routing and FORWARD lifecycle hooks;
- generate BIRD/BFD, Linux policy routing, systemd units, persistent Server1 FORWARD/fallback NAT, required BFD INPUT rules, and event-driven conntrack cleanup;
- generate MikroTik BGP/BFD and selective `CM_VPN` cleanup;
- choose a dedicated RouterOS table with `dst-address-list`/mangle or direct BGP prefixes in `main` without marking;
- download individual files or the complete generated set as a `.tar`;
- keep source-specific Server2 NAT/forwarding in `wg-exit.conf` and Server1 fallback NAT in a dedicated systemd unit.

### AWG 3.0 / 3.1

Generate mode defaults to **AWG 3.1**. Header Protection uses a dedicated 32-byte `HeaderProtectionKey`, equal `S1-S4=12`, and compatibility headers `H1=1, H2=2, H3=3, H4=4`. This follows the current AmneziaWG guidance for Header Protection and avoids the known ranged-H + RandomTrailers classifier issue.

The AWG 3.0 profile emits Header Protection plus timing/padding parameters but omits the 3.1-only `RandomTrailers` / `DisableCookies` toggles. AWG 3.1 adds those toggles and uses the current self-hosted defaults.

See [AWG 3.0/3.1 generation](docs/AWG3.en.md).

### Multiple Server2 exits

The configurator supports any practical number of exit Server2 nodes. Each exit gets a separate WireGuard interface on Server1 and its own Linux routing table. A lower `priority` number means a more preferred exit.

Example:

```text
priority 10 -> wg-exit  -> table 200
priority 20 -> wg-exit2 -> table 201
priority 30 -> wg-exit3 -> table 202
all DOWN    -> main     -> Server1 WAN
```

BFD monitors every exit independently. `vpn-exit-monitor` flushes VPN conntrack only when the actually selected exit changes; a lower-priority backup flapping while the primary remains healthy does not disturb current sessions.

See [Multiple Server2 exits and prioritized failover](docs/MULTI_EXIT.en.md).
Russian: [Несколько Server2 и приоритетный failover](docs/MULTI_EXIT.md).

### MikroTik routing modes

The configurator supports two modes:

1. **Address-list + mangle.** It creates connection/routing marks and a dedicated table receiving the configured prefix from Server1 via BGP. If BFD detects loss of MikroTik ↔ Server1 reachability, BGP withdraws the route and an explicit `/routing rule action=lookup table=main` provides fallback. Reply packets arriving over AWG are excluded from re-marking; catch-all fasttrack applies only to unmarked connections. Selective `CM_VPN` cleanup remains.
2. **Direct routes.** Enter DNS server IPs and other IPv4/CIDR destinations separately. Server1 advertises DNS IPs as `/32` and the other prefixes into `main` through BGP, without mangle or connection marks. MikroTik DNS settings are unchanged. Loss of BFD withdraws the routes. Requested `0.0.0.0/0` expands to two `/1` prefixes that take precedence over the regular WAN `/0` while the tunnel is alive.

Selective MikroTik conntrack cleanup is intentionally omitted in direct-route mode because there is no connection mark.

### Automated checks

The configurator has CI coverage. Changes run:

- JavaScript syntax validation;
- functional import/generation tests;
- negative tests for invalid subnets, PSK and parameters;
- checks that runtime network/storage APIs are absent;
- CSP `connect-src 'none'` verification;
- `bird -p` against generated BIRD configs;
- `wg-quick strip` against generated WireGuard configs;
- `bash -n` against the generated conntrack monitor.

### Configurator privacy

The configurator is fully static and has no backend.

- no analytics;
- no external JavaScript/CSS/CDN resources;
- no cookies;
- no `localStorage`, `sessionStorage`, `IndexedDB` or Service Worker;
- imported configurations are read through the File API and remain only in the current tab's memory;
- the page CSP contains `connect-src 'none'`, so application JavaScript cannot transmit data over the network;
- imported private keys are masked in previews by default;
- “Clear all data from this tab” removes imported values from the page state.

Opening the GitHub Pages site itself naturally downloads the static HTML/CSS/JS files from GitHub Pages, but imported configurations and keys are never transmitted by the application.

The configurator source is in [configurator/](configurator/).

## How it works

### 1. MikroTik sends selected traffic to Server1

Connections that should use the VPN path are marked `CM_VPN` on MikroTik and routed through AmneziaWG to Server1.

BFD may run inside the tunnel between MikroTik and Server1. For a point-to-point MikroTik address configured as `/32`, use:

```routeros
/ip address
add address=<AWG_MIKROTIK_IP>/32 network=<AWG_SERVER_IP> interface=<MT_AWG_IF>
```

This allows correct single-hop BFD source selection for BGP `use-bfd=yes`.

### 2. Server1 selects a dedicated routing table

Traffic arriving through `awg0` is directed to table `200`:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
```

An optional incoming WireGuard interface can use a second rule:

```bash
ip rule add priority 1001 iif <WG_IN_IF> lookup 200
```

### 3. Normal state: exit through Server2

While the Server1 ↔ Server2 BFD session is `Up`, BIRD exports a default route into Linux table `200`:

```text
default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird
```

Path:

```text
MikroTik
  ↓
AmneziaWG
  ↓
Server1
  ↓
table 200
  ↓
wg-exit
  ↓
Server2
  ↓
MASQUERADE
  ↓
Internet
```

### 4. Server2 or wg-exit failure

BFD detects loss of the peer. Recommended starting timers:

```text
min TX/RX: 500 ms
multiplier: 3
```

A complete failure is typically detected in roughly 1.5 seconds.

When BFD transitions to `Down`, BIRD removes the default route from table `200`:

```text
Deleted default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird
```

Because table `200` no longer has a matching default route, Linux continues with the next `ip rule` and uses `main`:

```text
VPN client
  ↓
table 200: no default
  ↓
main
  ↓
Server1 WAN
  ↓
MASQUERADE
  ↓
Internet
```

### 5. Conntrack cleanup on Server1

A route change alone does not rebuild old NAT/conntrack state.

The `vpn-exit-monitor` service listens to Netlink using:

```bash
ip monitor route
```

and reacts only to add/delete events for BIRD's default route in table `200`.

On both failover and failback, only VPN-client conntrack entries are removed, for example:

```bash
conntrack -D -s <AWG_NET>
conntrack -D -s <WG_IN_NET>
```

All unrelated Server1 connections are left untouched.

### 6. Failback

When Server2 returns:

1. WireGuard carries traffic again;
2. BFD transitions to `Up`;
3. BIRD restores the default route in table `200`;
4. `vpn-exit-monitor` clears VPN conntrack;
5. new connections immediately return to Server2.

### 7. MikroTik also clears stale sessions

MikroTik receives the Server1 route over BGP with `use-bfd=yes`. A script watches the active dynamic route in `VPN` and on `UP ↔ DOWN` transitions runs:

```routeros
/ip firewall connection remove [find where connection-mark="CM_VPN"]
```

This avoids waiting for old TCP/UDP/NAT states to expire after a path change.

### BFD firewall

BFD is control-plane traffic terminating on the node itself, so it traverses `INPUT`, not `FORWARD`.

This design uses single-hop BFD, therefore only UDP destination port `3784` is allowed, constrained by the exact tunnel source/destination addresses and interface:

- MikroTik accepts BFD from Server1 on the AWG interface;
- Server1 accepts BFD from MikroTik on `awg0` and from each Server2 on its corresponding `wg-exit*`;
- every Server2 accepts BFD from Server1 on `wg-exit`;
- Server2 also gets an explicit INPUT allow for its public WireGuard UDP listen port.

The generator creates narrow source/destination/interface rules rather than opening UDP/3784 globally.

### RouterOS: why routing-mark does not blackhole

In policy mode the generator creates a dedicated FIB table, for example `VPN`, and mangle sets `new-routing-mark=VPN`. Server1 advertises the selected prefix via BGP independently of Server2 state.

When BFD goes DOWN, BGP withdraws the prefix. With the default `mangle -> vrf-lookup -> vrf-unreach -> local -> user -> main` order, processing continues. The generator also creates an explicit fallback:

```routeros
/routing rule
add action=lookup routing-mark=VPN table=main comment="VPN_BFD_FALLBACK"
```

The use of `action=lookup` is intentional. `lookup` permits further fall-through, while `lookup-only-in-table` is the no-fallback form and can make the destination unreachable when the selected table has no active route.

The `VPN` table must not retain a legacy `distance=2` WAN default. If such a route is present, lookup succeeds inside `VPN` and RouterOS never reaches the `main` fallback.

If `/routing/settings policy-rules` was customized manually, verify before import that `mangle` runs before `user/main` and that `main` remains in the routing-decision chain.

## Why BFD instead of ping/Netwatch or recursive routes

**Important design assumption of this project:** Server1 and every Server2 are reached through the public Internet. Each inter-server `wg-exit` also terminates on the public Internet endpoint of its Server2; there is no separate private underlay carrying that tunnel.

For this topology, an established BFD session therefore means that the components required by the real forwarding path are alive at the same time: the Internet path to the remote server, WireGuard transport, the tunnel interface, the local firewall path, and the BIRD peer. If Internet reachability to a Server2 disappears, its WireGuard/BFD path also fails and BIRD withdraws that exit's default route.

This is why the project **intentionally does not use recursive routes with an external ping target** as its primary health check. Such a probe would test an additional third-party address and introduce another dependency, while BFD tests the actual Internet/WireGuard path used by the exit.

BFD is the primary liveness mechanism because it:

- supports short detection intervals;
- does not depend on a third-party Internet host;
- monitors the exact tunnel peer of interest;
- independently monitors every `wg-exit*` when multiple Server2 nodes are configured;
- integrates directly with BIRD on Linux;
- is used by BGP `use-bfd=yes` to monitor MikroTik ↔ Server1 reachability.

A separate Netwatch, recursive default through a public probe host, or ping watchdog is not required for **this topology**.

> This is a project design assumption, not a universal property of BFD. If a Server2 is later reachable through a private underlay, or if NAT/arbitrary external-destination reachability must be tested separately, an additional end-to-end health check may be appropriate.

## Repository layout

```text
.
├── README.md
├── README.en.md
├── FULL_GUIDE.md
├── LICENSE
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ARCHITECTURE.en.md
│   ├── INSTALL.md
│   ├── INSTALL.en.md
│   ├── OPERATIONS.md
│   ├── OPERATIONS.en.md
│   ├── AWG3.md / AWG3.en.md
│   ├── MULTI_EXIT.md
│   ├── MULTI_EXIT.en.md
│   ├── SECURITY.md
│   ├── SECURITY.en.md
│   ├── VARIABLES.md
│   └── VARIABLES.en.md
├── configs/
│   ├── mikrotik/
│   ├── server1/
│   └── server2/
└── configurator/
    ├── README.md / README.en.md
    ├── index.html
    ├── app.js
    └── style.css
```

## Documentation

- [Architecture](docs/ARCHITECTURE.en.md)
- [Installation](docs/INSTALL.en.md)
- [Operations and testing](docs/OPERATIONS.en.md)
- [AWG 3.0/3.1 generation](docs/AWG3.en.md)
- [Multiple Server2 exits and priorities](docs/MULTI_EXIT.en.md)
- [Publication security](docs/SECURITY.en.md)
- [Placeholder reference](docs/VARIABLES.en.md)
- [Configurator guide](configurator/README.en.md)
- [Full-guide index](FULL_GUIDE.md)
- [Russian README](README.md)

## Failover test

On Server2:

```bash
systemctl stop wg-quick@wg-exit
```

Expected:

```text
BFD DOWN
  ↓
BIRD removes the default from table 200
  ↓
vpn-exit-monitor flushes VPN conntrack
  ↓
new sessions exit through Server1
```

Restore:

```bash
systemctl start wg-quick@wg-exit
```

Automatic failback through Server2 is expected.

## Keeping Russian and English documentation in sync

`README.md` is the primary Russian guide, with a full English translation in `README.en.md`. In `docs/` and `configurator/`, unsuffixed Markdown files are Russian and `.en.md` files are English.

**Every functional change must update both versions in the same change set.**

A feature is considered documented only when:

1. it is described in the Russian README;
2. it is described in the English README;
3. related files under `docs/` and `configs/` are updated when necessary;
4. if the change affects generated topology/configuration, `configurator/` is updated in the same change.

## Security

Never commit:

- WireGuard/AmneziaWG private keys;
- real production passwords;
- API tokens;
- cloud credentials;
- unsanitized backup/export files;
- production files copied from `/etc/wireguard/` without review;
- real public IP addresses unless publication is intentional.

See [SECURITY.en.md](docs/SECURITY.en.md) before publication.

## License

This project is distributed under the permissive **MIT License**. See [LICENSE](LICENSE).

MIT is a simple permissive license well suited to documentation, configuration examples and small helper scripts. It allows use, modification, copying and redistribution while requiring preservation of the copyright and license notice.
