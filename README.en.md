# MikroTik → AmneziaWG → Ubuntu → WireGuard Exit with BFD Failover

[Русская версия](README.md)

This repository documents a resilient two-stage VPN routing design:

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

The preferred path goes through **Server2**. If Server2 or the `wg-exit` tunnel becomes unavailable, **BFD + BIRD** automatically remove the default route from Linux routing table `200`. Linux policy routing then falls through to Server1's normal `main` table, so traffic exits directly through Server1. When Server2 returns, the route is restored automatically.

On every **UP → DOWN** and **DOWN → UP** transition, only VPN-client conntrack state is cleared, so stale NAT/connection state does not delay failover or failback.

> This repository intentionally contains no real public IP addresses, private keys, passwords, tokens, production hostnames or other identifying infrastructure data. Placeholders are used instead.

## Features

- incoming AmneziaWG tunnel on Server1;
- optional additional incoming WireGuard interface;
- separate inter-server WireGuard tunnel `wg-exit`;
- BFD between Server1 and Server2;
- BIRD 2.x for automatic default-route installation/removal;
- Linux policy routing through table `200`;
- automatic fallback through Server1 WAN;
- automatic failback through Server2;
- event-driven Linux conntrack cleanup from Netlink route events;
- BFD between MikroTik and Server1 inside AmneziaWG;
- MikroTik `check-gateway=bfd`;
- cleanup only for connections marked `CM_VPN` when route state changes;
- persistence across Server1/Server2 reboots.

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
│   ├── SECURITY.md
│   └── VARIABLES.md
└── configs/
    ├── mikrotik/
    ├── server1/
    └── server2/
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Installation](docs/INSTALL.md)
- [Operations and testing](docs/OPERATIONS.md)
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
3. related files under `docs/` and `configs/` are updated when necessary.

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
