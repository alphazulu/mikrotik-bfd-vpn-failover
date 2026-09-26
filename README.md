# MikroTik → AmneziaWG → Ubuntu → WireGuard Exit with BFD Failover

This repository documents a two-stage VPN routing design with automatic failover and failback.

The design intentionally contains **no real public IP addresses, private keys, credentials, hostnames, or production identifiers**. Replace placeholders with local values before deployment.

## Goal

Traffic selected on a MikroTik router is sent through an AmneziaWG tunnel to **Server1**. Server1 normally forwards that traffic through a second WireGuard tunnel (`wg-exit`) to **Server2**, where it is NATed to the Internet.

If Server2 or the WireGuard path to it becomes unavailable, BFD detects the failure and BIRD removes the default route from Linux routing table `200`. Linux policy routing then naturally falls through to Server1's normal `main` table, so traffic exits directly through Server1. When Server2 returns, BIRD restores the route and traffic automatically returns to Server2.

Existing conntrack entries are flushed on both transitions so sessions are recreated through the currently active path instead of waiting for stale NAT/connection state to expire.

## High-level topology

```text
MikroTik
   |
   | AmneziaWG + BFD
   v
Server1
   |\
   | \ fallback: main table -> eth0 -> Internet
   |
   +-- policy table 200
          |
          | BFD-controlled default
          v
       wg-exit
          |
          v
       Server2
          |
          | MASQUERADE
          v
       Internet
```

Normal path:

```text
MikroTik -> AWG -> Server1 -> wg-exit -> Server2 -> Internet
```

Fallback path:

```text
MikroTik -> AWG -> Server1 -> eth0 -> Internet
```

## Main components

- MikroTik RouterOS 7
- AmneziaWG tunnel to Server1 (`awg0` on Server1)
- WireGuard tunnel between Server1 and Server2 (`wg-exit`)
- BIRD 2.x with BFD
- Linux policy routing, table `200`
- Linux conntrack cleanup triggered by Netlink route events
- MikroTik connection tracking cleanup for connections marked `CM_VPN`

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment guide](docs/INSTALL.md)
- [Operations and tests](docs/OPERATIONS.md)
- [Security and publication checklist](docs/SECURITY.md)
- [Placeholder reference](docs/VARIABLES.md)

## Important design choices

1. `wg-exit` on Server1 uses `Table = off`; it must not replace Server1's own default route.
2. Traffic entering Server1 through `awg0` is selected by `ip rule ... iif awg0 lookup 200`.
3. BIRD exports only the BFD-controlled default route into Linux table `200`.
4. When table `200` has no default route, Linux continues to the next policy rule and uses `main`.
5. Server1 performs NAT only on its own direct fallback path; Server2 performs NAT on the normal exit path.
6. BFD is set to approximately `500 ms × 3`, which gives a practical failure detection time around 1.5 seconds without being excessively aggressive.
7. Conntrack is cleared on both failover and failback.

## Repository safety

Never commit:

- WireGuard or AmneziaWG private keys
- real public IP addresses if the repository is intended to be public
- passwords, API tokens or cloud credentials
- raw production backups
- files copied directly from `/etc/wireguard/` without sanitizing them

See [SECURITY.md](docs/SECURITY.md) before publishing.
