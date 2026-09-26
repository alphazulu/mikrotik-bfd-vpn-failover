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

- Server1 `wg-exit.conf`;
- Server1 BIRD configuration;
- Server1 policy-routing systemd unit;
- Server1 event-driven conntrack monitor and service;
- Server2 `wg-exit.conf`;
- Server2 BIRD configuration;
- MikroTik RouterOS BFD/failover script;
- installation instructions;
- a local `.tar` bundle containing the complete generated set.

The generated bundle may contain real private keys imported by the user and must therefore be treated as sensitive.

## Language

The UI supports Russian and English from one implementation so both interfaces stay functionally identical.
