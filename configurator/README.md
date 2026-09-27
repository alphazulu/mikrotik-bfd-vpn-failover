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
- Server1 firewall unit with BFD UDP/3784 INPUT rules for MikroTik and every Server2 exit;
- Server1 event-driven conntrack monitor and service;
- one `wg-exit.conf` and BIRD responder configuration for every Server2, including INPUT rules for the public WireGuard listen port and inner BFD UDP/3784;
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
