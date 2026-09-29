# Замена MikroTik `check-gateway=bfd` на BGP + `use-bfd`

> Исторический протокол стенда и требования PR #4. Генератор реализует схему BGP + BFD; актуальные инструкции по установке и проверке находятся в [INSTALL.md](INSTALL.md) и [OPERATIONS.md](OPERATIONS.md). В policy mode можно анонсировать заданный IPv4/CIDR, а в direct mode запрос default разворачивается в два `/1`, чтобы обойти существующий WAN default в `main`.

Этот документ для агента, который будет менять генератор. Сам генератор здесь не меняется.

BFD между Server1 и каждым Server2 не трогать. Он на стенде поднимается и снимает default нужного выхода. Ниже речь только о ноге MikroTik ↔ Server1.

## Почему статический маршрут с BFD убираем

`check-gateway=bfd` на `/ip route` до сих пор числится неподдерживаемым:

- [BFD, Features not yet supported](https://manual.mikrotik.com/docs/user-guides/routing-and-networking-protocols/unicast/bfd) — пункт Enabling BFD for ip route gateways.

Поддерживаемый способ включить BFD — сессия BGP или OSPF, свойство `use-bfd`:

- [BGP](https://help.mikrotik.com/docs/display/ROS/BGP) — с RouterOS 7.20 BGP instance задаётся явно, минимальный пример: `/routing/bgp/instance add name=i1 as=...` и `/routing/bgp/connection add ... instance=i1 local.role=ebgp use-bfd=yes`.
- [routing/bgp/connection](https://manual.mikrotik.com/docs/cli-reference/routing/bgp/connection) — `instance` и `local.role` обязательны, фильтр выхода называется `output.filter-chain`, не `output.filter`. Входной фильтр — `input.filter`. `use-bfd` включает BFD для определения состояния соединения.

Тот же дефект описан пользователями с 7.14.2 и всё ещё воспроизводится на 7.19.6, 7.20.7 и 7.21.1: после загрузки или обрыва линка single-hop BFD, привязанный к статическому маршруту, не отвечает на UDP/3784, пока маршрут не выключить и не включить заново.

- [Single-hop BFD session is not restored after reboot or power outage](https://forum.mikrotik.com/t/single-hop-bfd-session-is-not-restored-after-reboot-or-power-outage/175189)

На стенде CHR 7.24.4 это подтвердилось отдельно от форума.

1. Сразу после импорта `.rsc` сессия `remote-address=10.88.99.1%wg-awg` остаётся `state=init`, `local-address=""`. CHR считает `packets-tx`, но на `wg-awg` ответов нет: там только пакеты Server1 → CHR. Маршрут при этом `active=true`, поэтому failover не начинается.
2. Один `/ip route disable` удаляет сессию, следующий `/ip route enable` создаёт новую, и она сразу `state=up`. Это обход дефекта, а не механизм.
3. После реального `ip link set wg-awg down/up` статический маршрут сам не возвращается. Разовое переключение при загрузке не лечит следующий обрыв. Поэтому скрипт, который только переключает маршрут на старте, не подходит.

Пустой `local-address` сам по себе не диагноз: на форуме он пустой и у рабочей сессии. На удачном BGP-прогоне ниже адрес как раз заполнился.

## Что проверено

CHR 7.24.4, BIRD 2.17.2, обычный WireGuard (на стенде не AmneziaWG), 2026-09-29. Статический `VPN_BFD_PRIMARY` удалён до поднятия BGP. Маршрут руками не переключали.

Холодный старт, около 2 с после `connection add`:

```text
BGP session Flags: E - ESTABLISHED
  remote.address=10.88.99.1 .as=65001 routing-table=VPN use-bfd=yes uptime=430ms
BFD Flags: U - UP
  remote-address=10.88.99.1%wg-awg local-address=10.88.99.4
  state=up state-changes=1 hold-time=1s500ms
route Flags: DAb
  dst-address=0.0.0.0/0 routing-table=VPN gateway=10.88.99.1
BIRD bgp_chr Established
BIRD BFD 10.88.99.4 wg-awg Up
```

Пинг клиента к `203.0.113.10` шёл с `172.16.1.12` (предпочтительный Server2).

`wg-awg` down: BGP-сессии больше нет, тот же пинг идёт с `172.16.1.2` (WAN CHR) через уже существующее правило `VPN_BFD_FALLBACK`.

`wg-awg` up, без `disable`/`enable` маршрута:

```text
BGP ESTABLISHED uptime=2s480ms last-started=01:52:26
BFD state=up state-changes=1 uptime=3s local-address=10.88.99.4
route DAb 0.0.0.0/0 routing-table=VPN gateway=10.88.99.1
BIRD 10.88.99.4 wg-awg Up since 01:52:27
```

Пинг снова с `172.16.1.12`.

Не проверено этим прогоном: direct mode, AmneziaWG вместо WireGuard, несколько префиксов вместо одного default, версии RouterOS старше 7.24.4.

## Рабочая конфигурация стенда

CHR, AS 65010, таблица `VPN` уже создана импортом:

```routeros
/routing bgp instance
add name=vpn as=65010 router-id=10.88.99.4 routing-table=VPN

/routing filter rule
add chain=bgp-in rule="if (dst == 0.0.0.0/0) { accept } else { reject }"
add chain=bgp-out rule="reject"

/routing bgp connection
add name=to-s1 instance=vpn remote.address=10.88.99.1 remote.as=65001 \
    local.role=ebgp connect=yes listen=yes use-bfd=yes \
    input.filter=bgp-in output.filter-chain=bgp-out

/ip firewall filter
add chain=input action=accept protocol=tcp dst-port=179 \
    src-address=10.88.99.1 in-interface=wg-awg comment=lab-bgp \
    place-before=[find where comment="lab-input-drop"]
```

`/routing bfd configuration` с `addresses=<Server1 tunnel>/32` и `interfaces=<AWG>` остаётся. Без явной записи BFD на RouterOS запрещён. Это уже не `check-gateway`, а допуск сессии, которую создаёт BGP.

BIRD на Server1. Default для анонса лежит в отдельной таблице и в ядро не ставится, иначе Server1 потеряет собственный маршрут:

```bird
ipv4 table t_chr;

protocol static chr_default {
    ipv4 { table t_chr; };
    route 0.0.0.0/0 reject;
}

protocol bgp bgp_chr {
    local 10.88.99.1 as 65001;
    neighbor 10.88.99.4 as 65010;
    interface "wg-awg";
    bfd on;
    ipv4 {
        table t_chr;
        import none;
        export all;
        next hop self;
    };
}
```

Сосед `10.88.99.4 dev wg-awg local 10.88.99.1` в уже существующем `protocol bfd` остаётся. `bfd on` у BGP использует его. На Server1 перед DROP нужен TCP/179 от адреса CHR к адресу Server1 на туннельном интерфейсе. UDP/3784 тоже остаётся.

## Что изменить в генераторе

Нижняя версия RouterOS для этой схемы — 7.20: раньше instance не был обязателен, на 7.24.4 `connection add` без `instance` останавливается на приглашении `instance:`.

Policy mode:

- Не создавать `/ip route ... check-gateway=bfd comment="VPN_BFD_PRIMARY"`.
- Создавать instance, два filter rule и connection, как выше. Имена и AS сделать параметрами; частные AS не должны пересекаться с тем, что пользователь уже использует. На стенде было 65010 на CHR и 65001 на Server1.
- `routing-table` instance — это существующая таблица policy mode (`VPN`), не `main`. Иначе default перебьёт WAN.
- `output.filter-chain` отвергает всё. CHR ничего не анонсирует.
- `input.filter` принимает только `0.0.0.0/0`. Не принимать другие маршруты Server1.
- Анонс не связывать с состоянием выходов Server2. Пока BGP жив, Server1 всегда отдаёт default. Отказ Server2 по-прежнему лечится на Server1. Иначе CHR уйдёт на свой WAN, хотя туннель жив и Server1 может выйти через собственный `main`.
- Mangle, `connection-mark=no-mark`, исключение входящего AWG в `mark-routing` и правило `VPN_BFD_FALLBACK` оставить. Когда BGP снимает маршрут, таблица пустеет и это правило уже уводит трафик в `main`.
- Скрипт `VPN-BFD-Conntrack` больше не ищет комментарий `VPN_BFD_PRIMARY`. Нет активного `0.0.0.0/0` в таблице `VPN` — это DOWN, маршрут появился — UP. На обоих переходах снимать только `connection-mark=CM_VPN`. Сейчас пустой `find` пишет warning и соединения не чистит.
- Планировщик раз в секунду оставить. Пинг в него не добавлять: живость даёт BFD.

Direct mode на стенде не гонялся. Там тот же сломанный `check-gateway=bfd`, его тоже убрать. Те же instance и connection, но `routing-table=main`, а `input.filter` принимает только заданные пользователем префиксы. Server1 анонсирует их из отдельной BIRD-таблицы, не из kernel. Пока сессия жива, префиксы стоят в `main` через gateway туннеля. Сессия падает — маршруты исчезают, остаётся обычный default. Отдельный BFD на каждый префикс не делать.

Firewall:

- Оставить узкий UDP/3784 между туннельными адресами.
- Добавить такой же узкий TCP/179. На CHR входящий SYN нужен, если Server1 подключается к слушающему CHR; `connect=yes` на обеих сторонах как раз это делает.
- ICMP-проверку вместо BFD не добавлять.

Документация, которую придётся поправить вместе с генератором: `README.md`, `docs/ARCHITECTURE.md`, `docs/INSTALL.md`, `docs/OPERATIONS.md` и английские копии. Формулировку «MikroTik следит через `check-gateway=bfd`» заменить на BGP + `use-bfd`. Абзацы, почему BFD, а не ping, для Server1 ↔ Server2 не переписывать: этот довод остаётся верным.

## Что не делать

- Не оставлять `check-gateway=bfd` и не «лечить» его disable/enable при старте.
- Не пинговать публичный адрес как признак жизни туннеля.
- Не отдавать в BGP default из таблиц 200/201. Это состояние выходов, не туннеля.
- Не ставить анонсируемый `0.0.0.0/0` в kernel Server1.
