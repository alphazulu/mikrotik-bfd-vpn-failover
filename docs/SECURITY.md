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
