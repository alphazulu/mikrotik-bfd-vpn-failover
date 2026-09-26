# Placeholder reference

Use placeholders in documentation and public repositories. Suggested mapping:

| Placeholder | Meaning |
|---|---|
| `<SERVER1_PUBLIC_IP>` | Public IPv4 of Server1 |
| `<SERVER2_PUBLIC_IP>` | Public IPv4 of Server2 |
| `<SERVER1_WAN_IF>` | Server1 Internet-facing interface, e.g. `eth0` |
| `<SERVER2_WAN_IF>` | Server2 Internet-facing interface, e.g. `eth0` |
| `<AWG_IF>` | AmneziaWG interface on Server1, normally `awg0` |
| `<AWG_NET>` | Client network behind `awg0` |
| `<AWG_SERVER_IP>` | Server1 address inside AmneziaWG |
| `<AWG_MIKROTIK_IP>` | MikroTik address inside AmneziaWG |
| `<MT_AWG_IF>` | MikroTik AmneziaWG/WireGuard-compatible interface name |
| `<WG_EXIT_NET>` | Inter-server WireGuard transfer subnet |
| `<WG_EXIT_S1_IP>` | Server1 address on `wg-exit` |
| `<WG_EXIT_S2_IP>` | Server2 address on `wg-exit` |
| `<WG_EXIT_PORT>` | UDP listen port on Server2 |
| `<WG_EXIT_MTU>` | Optional MTU for `wg-exit` when a non-default value is required |
| `<WG_EXIT_PRESHARED_KEY>` | Optional WireGuard PresharedKey; sensitive and identical on both peers |
| `<WG_IN_NET>` | Optional second incoming WireGuard client network on Server1 |
| `<WG_IN_IF>` | Optional incoming WireGuard interface on Server1 |
| `<SERVER1_WG_EXIT_PRIVATE_KEY>` | Server1 private key — never commit a real value |
| `<SERVER1_WG_EXIT_PUBLIC_KEY>` | Server1 public key |
| `<SERVER2_WG_EXIT_PRIVATE_KEY>` | Server2 private key — never commit a real value |
| `<SERVER2_WG_EXIT_PUBLIC_KEY>` | Server2 public key |

Example-only private address plan used in explanations can be chosen freely, but using placeholders is safer for a public repository.
