# Full guide

This repository documents a MikroTik → AmneziaWG → Ubuntu Server1 → WireGuard exit → Server2 design with BFD-based failover/failback and selective conntrack cleanup.

The complete guide is split into focused documents:

1. [Architecture](docs/ARCHITECTURE.md) — routing model, BFD/BIRD, NAT, conntrack and failure domains.
2. [Deployment](docs/INSTALL.md) — Server1, Server2 and MikroTik setup.
3. [Operations](docs/OPERATIONS.md) — health checks, failure tests, route events and troubleshooting.
4. [Variables](docs/VARIABLES.md) — placeholder reference.
5. [Security](docs/SECURITY.md) — publication and secret-handling checklist.

Ready-to-adapt sanitized examples are under `configs/`.

No production public IP addresses, private keys, credentials or identifying hostnames are included.
