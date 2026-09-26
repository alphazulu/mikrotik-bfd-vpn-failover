#!/bin/bash
set -u

TAG="vpn-exit-monitor"

VPN_NET_1="<AWG_NET>"
VPN_NET_2="<WG_IN_NET>"
WG_EXIT_S2_IP="<WG_EXIT_S2_IP>"

flush_vpn_conntrack() {
    logger -t "$TAG" "Flushing VPN conntrack"

    conntrack -D -s "$VPN_NET_1" >/dev/null 2>&1 || true

    if [ -n "$VPN_NET_2" ] && [ "$VPN_NET_2" != "<WG_IN_NET>" ]; then
        conntrack -D -s "$VPN_NET_2" >/dev/null 2>&1 || true
    fi
}

ip monitor route | while IFS= read -r line
do
    case "$line" in
        "Deleted default via ${WG_EXIT_S2_IP} dev wg-exit table 200 proto bird"*)
            logger -t "$TAG" "VPN exit DOWN: $line"
            flush_vpn_conntrack
            ;;
        "default via ${WG_EXIT_S2_IP} dev wg-exit table 200 proto bird"*)
            logger -t "$TAG" "VPN exit UP: $line"
            flush_vpn_conntrack
            ;;
    esac
done
