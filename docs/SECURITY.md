# Security and publication checklist

Before publishing this repository, verify that it does not contain production secrets or identifying infrastructure data.

## Never publish

- WireGuard private keys
- AmneziaWG private keys
- API tokens
- cloud provider credentials
- passwords
- backup archives
- exact production public IP addresses if disclosure is not intended
- personally identifying hostnames or comments

## Public keys

WireGuard public keys are not secret cryptographic material, but they can still identify a deployment. For a generic public guide, placeholders are preferable.

## Recommended `.gitignore`

This repository includes a `.gitignore` which excludes common secret/key patterns. It is not a substitute for reviewing every commit.

## Pre-publish scan

Before pushing:

```bash
grep -RniE '(PrivateKey|password|token|secret)' .
```

Review every match manually.

If you know the production public addresses, scan for them explicitly before publishing:

```bash
grep -Rni '<PRODUCTION_IP_1>' .
grep -Rni '<PRODUCTION_IP_2>' .
```

## Git history matters

Deleting a secret from the current version does not remove it from previous Git commits. If a secret was ever committed, rotate the secret and rewrite history before making the repository public.


## Browser configurator

The static configurator under `configurator/` is designed so imported production configuration never needs to leave the user's browser.

Security properties:

- no backend and no analytics;
- no external runtime JavaScript, CSS, fonts or CDN dependencies;
- Content Security Policy uses `connect-src 'none'`;
- no cookies, localStorage, sessionStorage, IndexedDB or Service Worker;
- imported files are read with the browser File API only;
- generated downloads are created with `Blob` / object URLs locally;
- private keys, PresharedKey values, and AWG `HeaderProtectionKey` are masked in preview unless the user explicitly reveals them.

The downloaded generated bundle can contain real private keys and must be treated as sensitive material.


## Local key generation

Generate mode uses the browser cryptographic random-number generator (`crypto.getRandomValues()`) and performs X25519 public-key derivation locally. Generated private keys and PSKs exist only in the current tab until downloaded; the application still has `connect-src 'none'` and does not send them over the network.

Downloaded generated bundles contain private keys, PSKs, and AWG HeaderProtectionKey values and must be treated as secrets.
