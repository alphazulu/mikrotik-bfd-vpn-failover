# AmneziaWG 3.0 / 3.1 generation

The configurator provides three AmneziaWG generation profiles:

- **AWG 2.0** — previous profile;
- **AWG 3.0 compatibility** — Header Protection + timing/padding without `RandomTrailers` / `DisableCookies`;
- **AWG 3.1** — recommended and selected by default.

## Important note about 3.0

In the current official AmneziaVPN source, the `awgV3` protocol marker is already `3.1`. Any configuration containing `HeaderProtectionKey` or the other AWG3 markers is classified by the current client as AWG 3.1.

Therefore **AWG 3.0 compatibility** in this project is a compatibility preset for the earlier 3.x parameter set, not a separate current protocol ID.

## Generated AWG 3.1 parameters

The configurator uses values aligned with the current self-hosted stack:

```ini
Jc = <random 4..6>
Jmin = 10
Jmax = 50

S1 = 12
S2 = 12
S3 = 12
S4 = 12

H1 = 1
H2 = 2
H3 = 3
H4 = 4

HeaderProtectionKey = <random 32-byte base64 key>

ContentPaddingAddition = 10-100
RekeyAfterTime = 100-120
RekeyTimeout = 3-7
RejectAfterTime = 150-180
KeepaliveTimeout = 5-15
MaxHandshakeAttempts = 15-20

RandomTrailers = on
DisableCookies = on
```

The generated client uses:

```ini
PersistentKeepalive = 25-35
```

## Why H1-H4 stay 1/2/3/4

With Header Protection enabled, current AmneziaWG guidance recommends compatibility values `H1=1`, `H2=2`, `H3=3`, `H4=4`. Message type hiding is performed by Header Protection instead.

This also avoids the known current AWG 3.1 classifier issue where ranged H values combined with `RandomTrailers=on` can misclassify transport packets and cause silent loss.

The generator therefore does **not** emit ranged H values for AWG 3.x.

## Why S1-S4 are 12

Header Protection uses the first 12 bytes of the matching S-prefix as its nonce, so every `S1-S4` value must be at least 12.

Using equal S values is also the safer configuration with `RandomTrailers=on`. The generator uses:

```text
S1=S2=S3=S4=12
```

## HeaderProtectionKey

The key is:

- generated with `crypto.getRandomValues()`;
- 32 bytes long;
- encoded as base64;
- identical in the generated server and client configs;
- masked in previews together with PrivateKey/PresharedKey.

Treat the downloaded value as secret material.

## CPS I1-I5

`I1-I5` are available in the Advanced section but are empty by default.

A CPS signature should imitate a deliberate target protocol; reusing one static template across every deployment can itself become a signature. Different `awg-quick` versions have also historically differed in CPS-string parsing.

When supplied manually, I1-I5 are emitted into the client AWG config. The server config intentionally omits them, matching the current self-hosted layout.

## AWG 3.0 compatibility

This profile emits Header Protection plus the timing/padding parameters but omits:

```ini
RandomTrailers =
DisableCookies =
```

and, like other AWG 3.x profiles in the current client, uses:

```ini
PersistentKeepalive = 25-35
```

For new installations, AWG 3.1 is preferred.

## Runtime

AWG 3.x requires a runtime/toolchain that understands the new configuration fields:

- current `amneziawg-tools`;
- current `amneziawg-go`, or a compatible AWG 3.1 kernel module.

Do not mix a new `awg/awg-quick` tool with an old kernel module: the interface may be created while `awg setconf` fails with `Invalid argument`.

Use a current 3.1 stack for the AWG 3.1 profile.

## Verification

After installation:

```bash
awg show
awg-quick strip <config>
```

Verify that server and client agree on HeaderProtectionKey, H1-H4, S1-S4, RandomTrailers, and DisableCookies, and that the peer keys match.
