#!/bin/bash
set -u

TAG="vpn-exit-monitor"

VPN_NET_1="<AWG_NET>"
VPN_NET_2="<WG_IN_NET>"
TABLES=(200)

flush_vpn_conntrack() {
    logger -t "$TAG" "Flushing VPN conntrack"

    conntrack -D -s "$VPN_NET_1" >/dev/null 2>&1 || true

    if [ -n "$VPN_NET_2" ] && [ "$VPN_NET_2" != "<WG_IN_NET>" ]; then
        conntrack -D -s "$VPN_NET_2" >/dev/null 2>&1 || true
    fi
}

selected_exit() {
    local table route
    for table in "${TABLES[@]}"; do
        route="$(ip -4 route show table "$table" default proto bird 2>/dev/null | head -n 1)"
        if [[ -n "$route" ]]; then
            printf '%s|%s\n' "$table" "$route"
            return
        fi
    done
    printf 'main\n'
}

last_exit="$(selected_exit)"
logger -t "$TAG" "Initial selected exit: $last_exit"

ip monitor route | while IFS= read -r line
do
    case "$line" in
        *default*" proto bird"*)
            [[ "$line" == *" table 200 "* ]] || continue
            sleep 0.1
            current_exit="$(selected_exit)"
            if [[ "$current_exit" != "$last_exit" ]]; then
                logger -t "$TAG" "Selected VPN exit changed: $last_exit -> $current_exit"
                flush_vpn_conntrack
                last_exit="$current_exit"
            fi
            ;;
    esac
done
