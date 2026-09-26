# Placeholder reference

Use placeholders in documentation and public repositories. Suggested mapping:

| Placeholder | Meaning |
|---|---|
| `<SERVER1_PUBLIC_IP>` | Public IPv4 of Server1 |
| `<SERVER2_PUBLIC_IP>` | Public IPv4 of a Server2 exit |
| `<SERVER2_N_PUBLIC_IP>` | Public IPv4 of additional Server2 number N |
| `<SERVER2_PRIORITY>` | Numeric exit priority; lower means more preferred |
| `<SERVER1_WAN_IF>` | Server1 Internet-facing interface, e.g. `eth0` |
| `<LINUX_POLICY_TABLE>` | Linux policy-routing table used for VPN client traffic in a single-exit setup |
| `<LINUX_POLICY_TABLE_BASE>` | First Linux policy-routing table for prioritized exits, normally `200` |
| `<SERVER2_WAN_IF>` | Server2 Internet-facing interface, e.g. `eth0` |
| `<AWG_IF>` | AmneziaWG interface on Server1, normally `awg0` |
| `<AWG_NET>` | Client network behind `awg0` |
| `<AWG_SERVER_IP>` | Server1 address inside AmneziaWG |
| `<AWG_MIKROTIK_IP>` | MikroTik address inside AmneziaWG |
| `<MT_AWG_IF>` | MikroTik AmneziaWG/WireGuard-compatible interface name |
| `<MT_ROUTE_TABLE>` | Dedicated RouterOS routing table for policy mode, not `main` |
| `<DST_ADDRESS_LIST>` | Existing RouterOS `dst-address-list` selected for the VPN path |
| `<WAN_INTERFACE_LIST>` | RouterOS interface list of WAN ports, excluded from policy marking |
| `<WG_EXIT_IF>` | Server1 WireGuard interface for one exit, e.g. `wg-exit`, `wg-exit2` |
| `<WG_EXIT_NET>` | Inter-server WireGuard transfer subnet; unique per Server2 |
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


## Multi-exit convention

For multiple Server2 nodes, suffix placeholders conceptually per exit:

```text
<WG_EXIT_IF_1>, <WG_EXIT_NET_1>, <WG_EXIT_S1_IP_1>, <WG_EXIT_S2_IP_1>
<WG_EXIT_IF_2>, <WG_EXIT_NET_2>, <WG_EXIT_S1_IP_2>, <WG_EXIT_S2_IP_2>
...
```

The configurator maps exits sorted by `<SERVER2_PRIORITY>` to Linux tables starting at `<LINUX_POLICY_TABLE_BASE>`.
