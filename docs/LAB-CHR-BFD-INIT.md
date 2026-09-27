# CHR 7.24.4: BFD-сессия с Server1 остаётся в init

Это отчёт о прогоне, а не исправление. Нужно повторить шаги на RouterOS 7.24.4 и подтвердить или опровергнуть два наблюдения ниже. Генератор в этом PR не менялся.

Прогон сделан на коммитах `70dabb6`, `663eef2` и `355cdeb`. На всех трёх результат одинаковый: 17 проверок прошли, две нет. Ошибка голого `:return` из `663eef2` сюда не входит: на `355cdeb` скрипт её уже не пишет.

## Что не сошлось

1. Single-hop BFD между CHR и Server1 не переходит в `up`.
   На CHR сессия остаётся `state=init`, `local-address=""`.
   У BIRD 2.17.2 сосед `10.88.99.4 dev wg-awg` остаётся `Down`.
   Две выходные сессии Server1–Server2 и Server1–Server3 при том же шаблоне правил становятся `Up`.
2. После того как туннель гаснет и снова поднимается, policy-маршрут в таблице `VPN` за 25 секунд не возвращает трафик в туннель. ICMP остаётся с WAN-адреса CHR. Сам WireGuard к этому моменту уже жив: следующий прямой `/32` с `check-gateway=bfd` уходит через Server2.

## Что при этом работает

Это не нужно заново чинить поломкой генератора:

- `/import` `mikrotik/bfd-failover.rsc` на 7.24.4 проходит. Маршрут создаётся как `gateway="10.88.99.1%wg-awg"`, `check-gateway=bfd`, `scope=30`, `target-scope=10`, `routing-table=VPN`.
- `VPN_BFD_INPUT` вставляется перед первый input drop.
- До обрыва туннеля клиентский ICMP на `203.0.113.10` выходит с `172.16.1.12`, затем с `172.16.1.13`, затем с WAN Server1 `172.16.1.11`, затем снова с `172.16.1.12`.
- Когда маршрут `VPN_BFD_PRIMARY` становится inactive, трафик уходит на WAN CHR `172.16.1.2`. Чёрной дыры нет. Срабатывает `VPN_BFD_FALLBACK` (`action=lookup routing-mark=VPN table=main`).
- На `355cdeb` скрипт пишет `initial state = UP` и затем `state changed UP -> DOWN, removing 2 connections`. Строки `Script Error` нет. Строки `DOWN -> UP` за окно восстановления тоже нет.

## Стенд

Это не часть репозитория. QEMU:

- CHR 7.24.4 stable, legacy BIOS;
- Alpine 3.22: Server1 `172.16.1.11`, Server2 `172.16.1.12`, Server3 `172.16.1.13`, шлюз `172.16.1.1` / цель `203.0.113.10`, клиент `10.10.10.2`;
- BIRD 2.17.2, `iptables`, обычный WireGuard (`ip link add type wireguard`). Имя `wg-awg` здесь не означает AmneziaWG и не включает обфускацию AWG 3.x.

Адреса, которые отдавались генератору:

| Роль | Значение |
|---|---|
| Server1 wg-exit | `10.77.66.1/30`, WAN `wan0`, UDP `51830`, priority 10, table 200 |
| Server2 | `10.77.66.2/30`, endpoint `172.16.1.12` |
| доп. выход | Server1 `10.77.67.1/30` `wg-exit2`, peer `10.77.67.2/30` endpoint `172.16.1.13`, priority 20, table 201 |
| AWG Server1 | `10.88.99.1/24`, ListenPort `51820`, iface `wg-awg` |
| MikroTik AWG | `10.88.99.4`, iface `wg-awg`, table `VPN`, dst `0.0.0.0/0`, address-list `vpn-test` = `203.0.113.10`, WAN list `WAN`, connmark `CM_VPN` |
| BFD | interval 500 ms, multiplier 3 |
| режим | policy, не direct |

CHR до импорта, это обвязка стенда, не генератора:

```routeros
/ip address add address=10.10.10.1/24 interface=ether1
/ip address add address=172.16.1.2/24 interface=ether2
/interface list add name=WAN
/interface list member add interface=ether2 list=WAN
/ip firewall address-list add list=vpn-test address=203.0.113.10
/ip settings set rp-filter=loose
/interface wireguard add name=wg-awg listen-port=51821 private-key="<lab>"
/interface wireguard peers add interface=wg-awg public-key="<server1>" endpoint-address=172.16.1.11 endpoint-port=51820 allowed-address=0.0.0.0/0 persistent-keepalive=5s
/ip firewall filter add chain=input action=accept connection-state=established,related comment=lab-established
/ip firewall filter add chain=input action=accept in-interface=ether1 comment=lab-lan
/ip firewall filter add chain=input action=accept protocol=udp dst-port=51821 in-interface=ether2 comment=lab-wg
/ip firewall filter add chain=input action=drop comment=lab-input-drop
/ip firewall filter add chain=forward action=fasttrack-connection connection-state=established,related comment=lab-ft
/ip firewall filter add chain=forward action=accept comment=lab-forward
/ip firewall nat add chain=srcnat out-interface=wg-awg action=masquerade
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade
/ip route add check-gateway=ping distance=1 dst-address=0.0.0.0/0 gateway=172.16.1.1 routing-table=main scope=30 target-scope=10 comment=LAB_WAN
```

Затем `/tool fetch` сгенерированного `bfd-failover.rsc` и `/import`. Файл импортировался целиком, без ручной правки синтаксиса. Планировщик `start-time=startup` на уже загруженной CHR не тикает, поэтому стенд выставлял `start-time` на текущее время плюс две секунды. Это не меняет текст скрипта.

На Linux сначала поднимались сгенерированные WireGuard, `bird.conf` и `vpn-failover-firewall.service`. После этого, чтобы новые INPUT accept были единственным пропуском, в конец цепочки добавлялся DROP. SSH шёл через другой интерфейс и не попадал под него. На Server1 после этого цепочка была такой:

```text
-A INPUT -s 10.77.67.2/32 -d 10.77.67.1/32 -i wg-exit2 -p udp --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT
-A INPUT -s 10.77.66.2/32 -d 10.77.66.1/32 -i wg-exit -p udp --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT
-A INPUT -s 10.88.99.4/32 -d 10.88.99.1/32 -i wg-awg -p udp --dport 3784 -m comment --comment vpn-failover-bfd -j ACCEPT
-A INPUT -i wan0 -p udp --dport 51820 -m comment --comment vpn-failover-listener -j ACCEPT
-A INPUT -m conntrack --ctstate RELATED,ESTABLISHED -m comment --comment lab-est -j ACCEPT
-A INPUT -i wan0 -m comment --comment lab-input-drop -j DROP
-A INPUT -i wg-awg -m comment --comment lab-input-drop -j DROP
-A INPUT -i wg-exit -m comment --comment lab-input-drop -j DROP
-A INPUT -i wg-exit2 -m comment --comment lab-input-drop -j DROP
```

Политика INPUT оставалась `ACCEPT`. Закрыты только `wan0` и туннели. Правила `vpn-failover-bfd` и `vpn-failover-listener` стоят выше DROP.

Сгенерированный сосед BIRD на Server1:

```text
protocol bfd bfd_exit {
    interface "wg-exit" { interval 500 ms; idle tx interval 500 ms; multiplier 3; };
    neighbor 10.77.66.2 dev "wg-exit" local 10.77.66.1;
    interface "wg-exit2" { interval 500 ms; idle tx interval 500 ms; multiplier 3; };
    neighbor 10.77.67.2 dev "wg-exit2" local 10.77.67.1;
    interface "wg-awg" { interval 500 ms; idle tx interval 500 ms; multiplier 3; };
    neighbor 10.88.99.4 dev "wg-awg" local 10.88.99.1;
}
```

На CHR генератор создаёт:

```routeros
/routing bfd configuration
add interfaces="wg-awg" addresses=10.88.99.1/32 min-rx=500ms min-tx=500ms multiplier=3

/ip firewall filter
add action=accept chain=input protocol=udp dst-port=3784 src-address=10.88.99.1/32 dst-address=10.88.99.4/32 in-interface="wg-awg" comment="VPN_BFD_INPUT" place-before=<first input drop>
```

## Шаги прогона

1. Сгенерировать файлы текущим конфигуратором в режиме policy с адресами выше.
2. Поднять туннели, BIRD и firewall unit. Добавить DROP на `wan0`/`wg-*` после accept-правил.
3. Импортировать `.rsc` на CHR, у которого уже есть input drop.
4. Дождаться WireGuard handshake и напечатать:
   - `/routing bfd session print detail`
   - `birdc show bfd sessions`
   - `:put [/ip route get [find where comment="VPN_BFD_PRIMARY"] active]`
5. С клиента `10.10.10.2` пинговать `203.0.113.10` и смотреть источник на шлюзе. Ожидаемый предпочитаемый источник: `172.16.1.12`.
6. `ip link set wg-exit down` на Server2. Ожидаемый источник: `172.16.1.13`.
7. `ip link set wg-exit down` на Server3. Ожидаемый источник: `172.16.1.11`.
8. Поднять оба выхода. Ожидаемый источник снова `172.16.1.12`.
9. На Server1: `ip link set wg-awg down`. Дождаться, пока `VPN_BFD_PRIMARY` станет inactive. Ожидаемый источник: `172.16.1.2`.
10. `ip link set wg-awg up`. До 25 секунд ждать `active=true` и снова пинговать. На стенде источник остался `172.16.1.2`.
11. Убрать mangle и `VPN_BFD_PRIMARY`, добавить в `main` прямой маршрут `203.0.113.10/32` с `check-gateway=bfd` и тем же gateway. Этот пинг уже шёл с `172.16.1.12`.

## Снимок с CHR

Сразу после того как маршрут уже отвечал `active=true` и клиентский трафик шёл через Server2. Снимок ниже с первого прогона (`70dabb6`); на `663eef2` и `355cdeb` повторились `state=init` и пустой `local-address`, счётчики пакетов заново не снимались.

```text
/routing bfd session print detail
0  multihop=no vrf=main remote-address=10.88.99.1%wg-awg local-address=""
   state=init state-changes=1 desired-tx-interval=500ms actual-tx-interval=1s
   required-min-rx=500ms remote-min-rx=500ms remote-min-tx=500ms multiplier=3
   hold-time=1s500ms packets-rx=12 packets-tx=6
```

В тот же момент BIRD:

```text
10.88.99.4                wg-awg     Down       ...    0.500    0.000
10.77.67.2                wg-exit2   Up         ...    0.500    1.500
10.77.66.2                wg-exit    Up         ...    0.500    1.500
```

Важно: `active=true` у `VPN_BFD_PRIMARY` при `state=init` не доказывает, что сессия поднялась. До первого подтверждённого падения маршрут может оставаться активным. После `UP -> DOWN` он в этом прогоне не вернулся за 25 секунд, хотя WireGuard уже снова переносил данные.

Лог на `355cdeb`:

```text
2026-09-27 11:41:04 script,info VPN-BFD: initial state = UP
2026-09-27 11:41:39 script,warning VPN-BFD: state changed UP -> DOWN, removing 2 connections
```

Восстановление `wg-awg` было в 11:41:46. К 11:42:40 четыре ICMP всё ещё шли с `172.16.1.2`. В 11:42:47 прямой `/32` шёл с `172.16.1.12`.

## Что проверить

Гипотеза, не вывод: CHR шлёт BFD не с `10.88.99.4`, потому что `local-address` пустой. Пакеты до CHR доходят (`packets-rx=12`), ответы CHR (`packets-tx=6`) не попадают в правило `-s 10.88.99.4/32 -d 10.88.99.1/32 --dport 3784` и их съедает `lab-input-drop` на `wg-awg`. Выходные сессии живы, потому что там с обеих сторон BIRD и адреса совпадают с правилами. Это нужно проверить дампом, а не считать доказанным.

Агенту имеет смысл снять три вещи и приложить их к PR:

1. `tcpdump -ni wg-awg udp port 3784` на Server1 в момент, когда CHR уже в `state=init`. Нужны реальные source, destination и порты в обе стороны.
2. Тот же прогон без `lab-input-drop` на `wg-awg`, чтобы отделить узкое правило от поведения самого BFD RouterOS. Если без DROP сессия становится `up`, проблема в совпадении адреса правила и фактического пакета. Если и без DROP она остаётся `init`, дело не в firewall.
3. После подтверждённого `down` поднять туннель и записать, через сколько секунд `VPN_BFD_PRIMARY` снова `active=true` и появляется ли `DOWN -> UP` в логе. Не считать успехом то, что прямой маршрут в `main` ожил раньше policy-маршрута.
