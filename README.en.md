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
- MikroTik `check-gateway=bfd`;
- cleanup only for connections marked `CM_VPN` when route state changes;
- persistence across Server1/Server2 reboots.

## Online configurator

The project now includes a local browser-based configurator:

**https://alphazulu.github.io/mikrotik-bfd-vpn-failover/**

It can:

- import `wg-exit` configurations for Server1 and Server2;
- add additional Server2 exits, assign a priority and dedicated Server1 WireGuard interface, and import both sides of each tunnel;
- optionally import the incoming AWG Server1 configuration and a separate `wg-in.conf`;
- extract internal tunnel IPs, endpoint, UDP port, WireGuard keys, optional `PresharedKey` and MTU;
- validate that Server1 and Server2 are in the same wg-exit subnet;
- validate client subnet and BFD parameters;
- generate ready-to-use Server1, Server2 and MikroTik configurations;
- generate an optional `server1/wg-in.conf` with its own `PostUp`/`PreDown` policy-routing and FORWARD lifecycle hooks;
- generate BIRD/BFD, Linux policy routing, systemd units, persistent Server1 FORWARD/fallback NAT, required BFD INPUT rules, and event-driven conntrack cleanup;
- generate MikroTik `check-gateway=bfd` and selective `CM_VPN` cleanup;
- choose between a dedicated RouterOS table with `dst-address-list`/mangle policy routing or direct static routes in `main` without marking;
- download individual files or the complete generated set as a `.tar`;
- keep source-specific Server2 NAT/forwarding in `wg-exit.conf` and Server1 fallback NAT in a dedicated systemd unit.

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

See [Multiple Server2 exits and prioritized failover](docs/MULTI_EXIT.md).  
Russian: [Несколько Server2 и приоритетный failover](docs/MULTI_EXIT.ru.md).

### MikroTik routing modes

The configurator supports two modes:

1. **Address-list + mangle.** It creates `mark-connection`, `mark-routing`, a dedicated routing table, and a BFD-monitored route. In RouterOS v7 `new-routing-mark` must reference an existing routing table, so the routing mark is the table name (for example `VPN`). If the BFD route in that table is inactive, the mangle lookup fails and processing continues; an explicit `/routing rule action=lookup table=main` makes fallback to `main` explicit. Catch-all fasttrack rules are limited to `connection-mark=no-mark` so `CM_VPN` traffic continues through mangle. Selective conntrack cleanup by `connection-mark` remains available.
2. **Direct routes.** The user supplies IPv4/CIDR destinations and the configurator creates ordinary static routes in `main` through the AWG gateway with `check-gateway=bfd`. No mangle or connection marks are generated. When BFD goes DOWN the routes become inactive and RouterOS uses other matching routes, normally the regular default route.

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

This allows correct single-hop BFD source selection and `check-gateway=bfd`.

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

MikroTik watches the BFD-monitored route to Server1. A stateful script remembers the previous route state and on `UP ↔ DOWN` transitions runs:

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

## Why BFD instead of ping/Netwatch

BFD is the primary liveness mechanism because it:

- supports short detection intervals;
- does not depend on a third-party Internet host;
- monitors the exact tunnel peer of interest;
- integrates directly with BIRD on Linux;
- can be used by MikroTik with `check-gateway=bfd`.

A separate Netwatch or ping watchdog is not required for this design.

## Repository layout

```text
.
├── README.md
├── README.en.md
├── FULL_GUIDE.md
├── LICENSE
├── docs/
│   ├── ARCHITECTURE.md
│   ├── INSTALL.md
│   ├── OPERATIONS.md
│   ├── MULTI_EXIT.md
│   ├── MULTI_EXIT.ru.md
│   ├── SECURITY.md
│   └── VARIABLES.md
├── configs/
│   ├── mikrotik/
│   ├── server1/
│   └── server2/
└── configurator/
    ├── index.html
    ├── app.js
    └── style.css
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Installation](docs/INSTALL.md)
- [Operations and testing](docs/OPERATIONS.md)
- [Multiple Server2 exits and priorities](docs/MULTI_EXIT.md)
- [Publication security](docs/SECURITY.md)
- [Placeholder reference](docs/VARIABLES.md)
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

`README.md` and `README.en.md` are equal-language versions of the main project documentation.

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

See [SECURITY.md](docs/SECURITY.md) before publication.

## License

This project is distributed under the permissive **MIT License**. See [LICENSE](LICENSE).

MIT is a simple permissive license well suited to documentation, configuration examples and small helper scripts. It allows use, modification, copying and redistribution while requiring preservation of the copyright and license notice.
