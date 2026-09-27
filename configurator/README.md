# Local-only configurator

This directory contains a static browser-only generator for the architecture documented by this repository.

## Privacy properties

- no backend;
- no analytics;
- no external JavaScript or CSS;
- no CDN resources;
- no cookies;
- no localStorage/sessionStorage/IndexedDB;
- no service worker;
- imported files are read with the browser File API;
- Content Security Policy contains `connect-src 'none'`, so application JavaScript cannot make network connections.

Opening the GitHub Pages site itself naturally downloads the static HTML/CSS/JS files from GitHub Pages. Imported WireGuard/AmneziaWG configuration data and keys are never transmitted by the application.

## Generated files

The configurator produces:

- one Server1 WireGuard config per exit (`wg-exit.conf`, `wg-exit2.conf`, ...);
- Server1 BIRD configuration;
- Server1 policy-routing systemd unit;
- Server1 firewall unit with explicit INPUT permissions for the AWG UDP listen port, optional wg-in listen port, and BFD UDP/3784 from MikroTik and every Server2 exit;
- Server1 event-driven conntrack monitor and service;
- one `wg-exit.conf` and BIRD responder configuration for every Server2, including an explicit WAN-side INPUT rule for its WireGuard UDP listen port and an inner INPUT rule for BFD UDP/3784;
- MikroTik RouterOS BFD/failover script with a narrow `chain=input` BFD UDP/3784 allow plus either address-list/mangle policy routing or direct destination routes;
- installation instructions;
- a local `.tar` bundle containing the complete generated set.

The generated bundle may contain real private keys imported by the user and must therefore be treated as sensitive.

## Language

The UI supports Russian and English from one implementation so both interfaces stay functionally identical.


## MikroTik routing modes

The UI offers two mutually exclusive modes:

- **Address-list + mangle** — generates connection marks, a dedicated routing table, and selective conntrack cleanup. The routing mark is the existing table name. When its BFD route is inactive, lookup fails and one explicit `/routing rule` falls back to `main`. Catch-all fasttrack rules are limited to unmarked connections.
- **Direct routes** — generates BFD-monitored static routes in `main` for the supplied IPv4/CIDR destinations and does not generate mangle/connection marks.

Direct-route mode deliberately omits selective MikroTik conntrack cleanup because there is no connection mark to target.


## Health-check model

This configurator intentionally generates **BFD-based liveness**, not recursive routes to external ping targets.

Project topology assumption:

```text
MikroTik -> public Internet -> Server1
Server1  -> public Internet -> Server2 public WG endpoint
```

The BFD session for each `wg-exit*` therefore rides over the actual Internet/WireGuard path used to reach that Server2. If that path is unavailable, BFD goes DOWN and BIRD withdraws that exit's default. With multiple Server2 nodes, every exit has its own independent BFD session.

**Maintainer/agent note:** do not add a second recursive-route/public-probe health mechanism as a supposed fix for "Server2 Internet liveness" under the current topology. It would introduce a separate third-party probe and a different failure domain. Add such an end-to-end probe only if the topology changes, for example if Server2 becomes reachable through a private underlay or explicit NAT/arbitrary-public-destination validation becomes a requirement.

## Multiple Server2 exits

The configurator can add multiple exit Server2 nodes.

Each exit has:

- a numeric priority (lower is preferred);
- its own Server1 WireGuard interface;
- its own point-to-point transfer subnet;
- its own endpoint, keys, optional PSK/MTU and Server2 WAN interface.

Exits are sorted by priority and mapped to consecutive Linux routing tables starting at the configured base table. Server1 policy rules try those tables in order, then naturally fall through to `main`.

The generated BIRD configuration tracks every exit independently with BFD. The generated conntrack monitor flushes VPN client state only when the effective selected exit changes.

Both sides of every additional WireGuard tunnel can be imported locally in the browser. No imported data is transmitted.


## Explicit server listener ports

Server firewall generation is deny-by-default-friendly: every UDP service that must accept unsolicited inbound traffic gets an explicit INPUT rule.

- Server1 AWG ListenPort is required and is imported from the incoming AWG config when present.
- Optional Server1 wg-in ListenPort is permitted when a complete wg-in config is generated.
- Every Server2 wg-exit ListenPort is permitted on that Server2 WAN interface.
- BFD UDP/3784 is permitted only on the relevant tunnel interface and exact peer/local tunnel addresses.

Server1 outbound wg-exit interfaces do not require a public listener rule because they initiate the WireGuard transport and do not define a fixed ListenPort in the generated config.


## Import or generate

Configuration sources are independent:

- **Incoming AWG / wg-in** can be imported or generated.
- **Inter-server wg-exit** has its own selector: import existing Server1/Server2 configs or generate fresh tunnels.

Inter-server generation creates new X25519 key pairs locally in the browser for the primary Server2 and every additional exit. If enabled, each tunnel receives its own 32-byte PresharedKey. Empty transfer addresses are populated with separate /30 networks; public Server2 endpoints remain explicit user input.

Generation mode creates:
- Server1/Server2 `wg-exit` key material for the primary and every additional Server2;
- `server1/<awg-interface>.conf` plus `clients/<awg-interface>-client.conf`;
- optional `server1/wg-in.conf` plus `clients/wg-in-client.conf`.

AmneziaWG generation supports AWG 2.0, AWG 3.0, and AWG 3.1. AWG 3.1 is the default. AWG 3.x profiles generate a 32-byte `HeaderProtectionKey`, set `S1-S4=12` and `H1-H4=1/2/3/4`, emit current timing/padding ranges, and support optional CPS `I1-I5`. AWG 3.1 also emits `RandomTrailers=on`, `DisableCookies=on`, and client `PersistentKeepalive=25-35`. The server config intentionally omits I1-I5 while the generated client config may contain them, matching the current self-hosted layout.

The Server1 public endpoint is required only for generated client configs.


### Inter-server WG generation

When **Generate Server1 ↔ Server2 wg-exit configs** is selected:

- the primary `wg-exit` pair can be generated without importing either side;
- all additional Server2 entries can be generated together;
- a newly added Server2 can be generated independently from its card;
- each exit gets independent Server1/Server2 X25519 key pairs;
- optional PSK generation is per tunnel, not shared between exits;
- empty transfer addresses are assigned separate `/30` networks;
- endpoint, UDP port, priority, WAN interface and MTU remain reviewable/editable before final file generation.

The final bundle still emits ordinary `server1/wg-exit*.conf` and `server2*/wg-exit.conf` files, so import and generation converge on the same validation and output path.
