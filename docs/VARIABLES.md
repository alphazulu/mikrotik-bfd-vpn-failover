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
| `<WG_IN_SERVER_ADDRESS>` | Optional Server1 address/prefix on `wg-in` |
| `<WG_IN_PORT>` | Optional UDP listen port for `wg-in` |
| `<WG_IN_PRIVATE_KEY>` | Optional Server1 `wg-in` private key — never commit a real value |
| `<WG_IN_PEER_PUBLIC_KEY>` | Optional `wg-in` peer public key |
| `<WG_IN_PEER_ALLOWED_IPS>` | Optional `AllowedIPs` for the `wg-in` peer |
| `<WG_IN_PRESHARED_KEY>` | Optional `wg-in` PresharedKey |
| `<SERVER1_WG_EXIT_PRIVATE_KEY>` | Server1 private key — never commit a real value |
| `<SERVER1_WG_EXIT_PUBLIC_KEY>` | Server1 public key |
| `<SERVER2_WG_EXIT_PRIVATE_KEY>` | Server2 private key — never commit a real value |
| `<SERVER2_WG_EXIT_PUBLIC_KEY>` | Server2 public key |

Example-only private address plan used in explanations can be chosen freely, but using placeholders is safer for a public repository.
