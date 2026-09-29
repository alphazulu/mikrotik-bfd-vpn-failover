# MikroTik → AmneziaWG → Ubuntu → WireGuard Exit с BFD failover

[English version](README.en.md)

Этот репозиторий описывает отказоустойчивую многоступенчатую схему маршрутизации VPN-трафика. Базовый вариант использует один Server2, а расширенный — несколько Server2 с заданными приоритетами:

```text
MikroTik
   │
   │ AmneziaWG + BFD
   ▼
Server1
   ├──────────── fallback ────────────► Internet
   │             через eth0
   │
   └─ table 200 ─► wg-exit ─► Server2 ─► Internet
                    BFD          NAT
```

Основной путь проходит через Server2 с наивысшим приоритетом. Если он или его `wg-exit` становится недоступен, **BFD + BIRD** убирают default route из соответствующей Linux routing table, после чего policy routing пробует следующий Server2. Если недоступны все Server2, трафик естественным образом доходит до обычного `main` route Server1. После восстановления более приоритетного выхода происходит автоматический failback.

При каждом переходе **UP → DOWN** и **DOWN → UP** очищается только conntrack VPN-клиентов, поэтому старые NAT/connection states не мешают быстрому failover/failback.

> В репозитории намеренно нет реальных публичных IP-адресов, приватных ключей, паролей, токенов, production-hostname и других идентификаторов инфраструктуры. Используются placeholders.

## Возможности

- входящий AmneziaWG-туннель на Server1;
- опциональный дополнительный входящий WireGuard-интерфейс;
- один или несколько независимых межсерверных WireGuard-выходов `wg-exit`, `wg-exit2`, ...;
- независимый BFD между Server1 и каждым Server2;
- явные firewall INPUT rules для всех серверных VPN-listener ports (Server1 AWG, optional wg-in, каждый Server2 wg-exit) и single-hop BFD UDP/3784;
- BIRD 2.x для автоматического добавления/удаления default route;
- упорядоченный Linux policy routing через table `200`, `201`, `202`, ... согласно priority Server2;
- автоматический переход Server2 → следующий Server2 → WAN Server1;
- автоматический failback на самый приоритетный доступный Server2;
- event-driven очистка Linux conntrack через Netlink route events;
- BFD между MikroTik и Server1 внутри AmneziaWG;
- BGP `use-bfd=yes` между MikroTik и Server1 вместо BFD на статическом маршруте;
- очистка только соединений с `connection-mark=CM_VPN` при смене состояния маршрута;
- сохранение работоспособности после перезагрузок Server1/Server2.

## Онлайн-конфигуратор

Для проекта добавлен локальный браузерный конфигуратор:

**https://alphazulu.github.io/mikrotik-bfd-vpn-failover/**

Он умеет:

- независимо выбирать источник входящих AWG/wg-in и межсерверных `wg-exit`: импорт готовых `.conf` или локальная генерация;
- импортировать `wg-exit` конфигурации Server1 и Server2;
- добавлять дополнительные Server2, задавать каждому priority, отдельный Server1 WireGuard interface и импортировать обе стороны его туннеля;
- опционально импортировать входящий AWG-конфиг Server1 и отдельный `wg-in.conf`;
- автоматически извлекать внутренние tunnel IP, endpoint, UDP listen ports (включая Server1 AWG), WireGuard keys, optional `PresharedKey` и MTU;
- локально генерировать X25519 key pairs и 32-byte PSK через browser CSPRNG;
- отдельно сгенерировать все межсерверные `wg-exit` пары Server1 ↔ Server2, включая дополнительные Server2: уникальные key pairs, отдельный optional PSK и отдельную `/30` transfer subnet для каждого выхода;
- генерировать пару AmneziaWG server/client для AWG 2.0, AWG 3.0 и AWG 3.1; AWG 3.1 выбран по умолчанию;
- для AWG 3.x генерировать HeaderProtectionKey, S1-S4 >= 12, H1-H4=1/2/3/4, timing/padding ranges и optional CPS I1-I5;
- для AWG 3.1 дополнительно генерировать `RandomTrailers=on` и `DisableCookies=on`, а также `PersistentKeepalive=25-35` в клиентском профиле;
- генерировать `wg-exit` для всех Server2 и optional `wg-in` server/client;
- проверять, что Server1/Server2 находятся в одной wg-exit подсети;
- проверять client subnet и BFD-параметры;
- генерировать готовые конфиги Server1, Server2 и MikroTik;
- генерировать optional `server1/wg-in.conf` с собственными `PostUp`/`PreDown` для `ip rule` и FORWARD;
- генерировать BIRD/BFD, Linux policy routing, systemd units, persistent Server1 FORWARD/fallback NAT, необходимые BFD INPUT rules и event-driven conntrack cleanup;
- формировать BGP + BFD на MikroTik и выборочную очистку `CM_VPN`;
- выбирать режим MikroTik: отдельная RouterOS routing table + `dst-address-list`/mangle либо BGP-префиксы в `main` без маркировки;
- скачивать отдельные файлы или весь комплект одним `.tar`;
- сохранять source-specific NAT/forwarding для Server2 в `wg-exit.conf`, а fallback NAT Server1 — в отдельном systemd unit.

### AWG 3.0 / 3.1

Режим генерации по умолчанию создаёт **AWG 3.1**. Для Header Protection используются отдельный 32-byte `HeaderProtectionKey`, одинаковые `S1-S4=12` и совместимые фиксированные `H1=1, H2=2, H3=3, H4=4`. Это соответствует текущей рекомендации AmneziaWG для Header Protection и избегает известной проблемы ranged H + RandomTrailers.

Профиль AWG 3.0 создаёт Header Protection и timing/padding параметры, но не добавляет 3.1-only toggles `RandomTrailers` / `DisableCookies`. Профиль AWG 3.1 добавляет их и использует актуальные self-hosted defaults.

Подробно: [Генерация AWG 3.0/3.1](docs/AWG3.md).

### Несколько Server2

Конфигуратор поддерживает любое практическое количество выходных Server2. Для каждого создаётся отдельный WireGuard-интерфейс на Server1 и отдельная Linux routing table. Меньшее значение `priority` означает более предпочтительный выход.

Пример:

```text
priority 10 -> wg-exit  -> table 200
priority 20 -> wg-exit2 -> table 201
priority 30 -> wg-exit3 -> table 202
all DOWN    -> main     -> Server1 WAN
```

BFD контролирует каждый выход независимо. `vpn-exit-monitor` очищает VPN conntrack только когда фактически выбранный выход меняется; отказ или восстановление неактивного backup-сервера не трогает текущие соединения.

Подробно: [Несколько Server2 и приоритетный failover](docs/MULTI_EXIT.md).
English: [Multiple Server2 exits and prioritized failover](docs/MULTI_EXIT.en.md).

### Режимы маршрутизации MikroTik

Конфигуратор поддерживает два варианта:

1. **Address-list + mangle.** Для выбранных `dst-address-list` создаются `mark-connection`, `mark-routing` и отдельная routing table с маршрутом, получаемым от Server1 по BGP. В RouterOS v7 `new-routing-mark` ссылается на эту таблицу (например, `VPN`). Если BFD обнаруживает потерю пути MikroTik ↔ Server1, BGP отзывает префикс, и `/routing rule action=lookup table=main` выполняет fallback. Входящий AWG-интерфейс исключён из повторной маркировки ответов, общие fasttrack-правила ограничены `connection-mark=no-mark`. Выборочная очистка `CM_VPN` остаётся.
2. **Прямые маршруты.** Пользователь задаёт IPv4/CIDR, Server1 анонсирует их по BGP в `main` без mangle и connection marks. После потери BFD маршруты отзываются. Запрос `0.0.0.0/0` преобразуется в два маршрута `/1`, которые при живом туннеле имеют приоритет над штатным WAN default `/0`.

Во втором режиме selective conntrack cleanup на MikroTik намеренно не создаётся, поскольку нет connection mark.

### Автоматические проверки

Для конфигуратора добавлен CI. При изменениях выполняются:

- синтаксическая проверка JavaScript;
- функциональные тесты импорта и генерации;
- негативные тесты для неправильных подсетей, PSK и параметров;
- проверка отсутствия runtime network/storage API;
- проверка CSP `connect-src 'none'`;
- `bird -p` для сгенерированных BIRD-конфигов;
- `wg-quick strip` для сгенерированных WireGuard-конфигов;
- `bash -n` для shell-скрипта conntrack monitor;
- `systemd-analyze verify` для сгенерированных firewall/policy-routing units;
- regression assertions для UDP/3784 BFD INPUT rules на Server1, Server2 и MikroTik.

### Приватность конфигуратора

Конфигуратор полностью статический и не имеет серверной части.

- нет analytics;
- нет внешних JS/CSS/CDN;
- нет cookies;
- не используются `localStorage`, `sessionStorage`, `IndexedDB` и Service Worker;
- выбранные конфиги читаются через File API только в памяти текущей вкладки;
- CSP страницы содержит `connect-src 'none'`, поэтому JavaScript приложения не может отправлять данные по сети;
- импортированные private keys маскируются в preview по умолчанию;
- после нажатия «Очистить всё из памяти вкладки» импортированные значения удаляются из состояния страницы.

Открытие самой GitHub Pages страницы, естественно, загружает статические HTML/CSS/JS-файлы с GitHub Pages, но импортированные конфиги и ключи приложением никуда не отправляются.

Исходный код конфигуратора находится в [configurator/](configurator/).

## Как это работает

### 1. MikroTik отправляет выбранный трафик в Server1

На MikroTik нужные соединения маркируются `CM_VPN` и маршрутизируются через AmneziaWG до Server1.

Внутри туннеля между MikroTik и Server1 может работать BFD. Для point-to-point адреса MikroTik с `/32` используется:

```routeros
/ip address
add address=<AWG_MIKROTIK_IP>/32 network=<AWG_SERVER_IP> interface=<MT_AWG_IF>
```

Это позволяет корректно использовать single-hop BFD с BGP `use-bfd=yes`.

### 2. Server1 выбирает отдельную routing table

Трафик, пришедший через `awg0`, направляется в table `200`:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
```

Для дополнительного входящего WireGuard можно использовать второе правило:

```bash
ip rule add priority 1001 iif <WG_IN_IF> lookup 200
```

### 3. Нормальный режим: выход через Server2

Пока BFD-сессия Server1 ↔ Server2 находится в состоянии `Up`, BIRD экспортирует default route в Linux table `200`:

```text
default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird
```

Путь:

```text
MikroTik
  ↓
AmneziaWG
  ↓
Server1
  ↓
table 200
  ↓
wg-exit
  ↓
Server2
  ↓
MASQUERADE
  ↓
Internet
```

### 4. Отказ Server2 или wg-exit

BFD обнаруживает потерю peer. Рекомендуемые стартовые параметры:

```text
min TX/RX: 500 ms
multiplier: 3
```

Практическое время обнаружения полного отказа — примерно 1.5 секунды.

После перехода BFD в `Down` BIRD удаляет default route из table `200`:

```text
Deleted default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird
```

В table `200` больше нет подходящего default route, поэтому Linux продолжает обработку следующих `ip rule` и использует `main`:

```text
VPN client
  ↓
table 200: default отсутствует
  ↓
main
  ↓
Server1 WAN
  ↓
MASQUERADE
  ↓
Internet
```

### 5. Очистка conntrack на Server1

Изменение маршрута само по себе не пересоздаёт старые NAT/conntrack states.

Сервис `vpn-exit-monitor` слушает Netlink:

```bash
ip monitor route
```

и реагирует именно на добавление/удаление BIRD default route в table `200`.

При failover и failback удаляются только conntrack entries VPN-сетей, например:

```bash
conntrack -D -s <AWG_NET>
conntrack -D -s <WG_IN_NET>
```

Все остальные соединения Server1 остаются нетронутыми.

### 6. Failback

Когда Server2 возвращается:

1. WireGuard снова передаёт трафик;
2. BFD переходит в `Up`;
3. BIRD возвращает default route в table `200`;
4. `vpn-exit-monitor` очищает VPN conntrack;
5. новые соединения сразу снова идут через Server2.

### 7. MikroTik тоже очищает старые соединения

MikroTik получает маршрут Server1 по BGP с `use-bfd=yes`. Скрипт следит за активным динамическим маршрутом в таблице `VPN` и при переходах `UP ↔ DOWN` выполняет:

```routeros
/ip firewall connection remove [find where connection-mark="CM_VPN"]
```

Таким образом, при смене пути не приходится ждать таймаутов старых TCP/UDP/NAT states.

### Firewall для BFD

BFD — это control-plane traffic, который завершается на самом узле, поэтому он проходит через `INPUT`, а не `FORWARD`.

В этой схеме используется single-hop BFD, поэтому разрешается только UDP destination port `3784` и только между точными tunnel IP/interface:

- MikroTik принимает BFD от Server1 на AWG-интерфейсе;
- Server1 принимает BFD от MikroTik на `awg0` и от каждого Server2 на соответствующем `wg-exit*`;
- каждый Server2 принимает BFD от Server1 на своём `wg-exit`;
- Server2 также получает explicit INPUT allow для публичного WireGuard UDP listen port.

Генератор создаёт узкие правила по source/destination/interface, а не общий allow UDP/3784 со всех сетей.

### RouterOS: почему routing-mark не уходит в black hole

В policy-mode генератор создаёт отдельную FIB-таблицу, например `VPN`, и mangle ставит `new-routing-mark=VPN`. Server1 анонсирует в неё настроенный префикс через BGP независимо от состояния Server2.

При потере BFD BGP отзывает маршрут. При стандартном порядке `mangle -> vrf-lookup -> vrf-unreach -> local -> user -> main` поиск продолжается. Генератор дополнительно создаёт явный fallback:

```routeros
/routing rule
add action=lookup routing-mark=VPN table=main comment="VPN_BFD_FALLBACK"
```

Здесь принципиально используется `action=lookup`, а не `lookup-only-in-table`: `lookup` допускает дальнейший fallback, тогда как `lookup-only-in-table` используется для режима без fallback и при отсутствии маршрута делает destination недоступным.

В самой таблице `VPN` не должно оставаться старого резервного default `distance=2` через WAN. Иначе lookup в `VPN` успешно выберет его и до fallback в `main` RouterOS не дойдёт.

Если на MikroTik вручную менялся `/routing/settings policy-rules`, перед импортом нужно проверить, что `mangle` выполняется до `user/main`, а `main` остаётся в routing decision chain.

## Почему BFD, а не ping/Netwatch или рекурсивные маршруты

**Важное архитектурное допущение этого проекта:** доступ и к Server1, и к каждому Server2 осуществляется через публичный Internet. Межсерверный `wg-exit` также устанавливается на публичный Internet endpoint Server2, а не через отдельную приватную underlay-сеть.

Поэтому для этой конкретной схемы успешная BFD-сессия означает, что одновременно живы именно те компоненты, которые нужны рабочему пути: Internet-path до удалённого сервера, WireGuard transport, tunnel interface, локальный firewall и BIRD peer. Если Internet-путь до Server2 пропадает, перестаёт проходить и WireGuard/BFD, и BIRD снимает default этого exit.

Именно поэтому здесь **намеренно не используются рекурсивные маршруты с внешним ping-target** как основной health-check: они проверяли бы дополнительный сторонний адрес и добавляли бы ещё одну зависимость, тогда как BFD проверяет непосредственно тот Internet/WireGuard path, через который реально идёт трафик.

BFD используется как основной liveness-механизм, потому что он:

- работает с короткими интервалами;
- не зависит от доступности стороннего Internet-host;
- контролирует непосредственно нужный туннельный peer;
- при нескольких Server2 независимо контролирует каждый `wg-exit*`;
- интегрирован с BIRD на Linux;
- используется BGP `use-bfd=yes` для контроля туннеля MikroTik ↔ Server1.

Netwatch, рекурсивный default через публичный probe-host или отдельный ping-watchdog для **этой топологии** не требуется.

> Это именно design assumption проекта, а не универсальное свойство BFD. Если Server2 когда-либо будет доступен через приватную underlay-сеть или потребуется отдельно проверять NAT/доступность произвольных внешних Internet-host, тогда дополнительный end-to-end health-check может быть оправдан.

## Структура репозитория

```text
.
├── README.md
├── README.en.md
├── FULL_GUIDE.md
├── LICENSE
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ARCHITECTURE.en.md
│   ├── INSTALL.md
│   ├── INSTALL.en.md
│   ├── OPERATIONS.md
│   ├── OPERATIONS.en.md
│   ├── AWG3.md / AWG3.en.md
│   ├── MULTI_EXIT.md
│   ├── MULTI_EXIT.en.md
│   ├── SECURITY.md
│   ├── SECURITY.en.md
│   ├── VARIABLES.md
│   └── VARIABLES.en.md
├── configs/
│   ├── mikrotik/
│   ├── server1/
│   └── server2/
└── configurator/
    ├── README.md / README.en.md
    ├── index.html
    ├── app.js
    └── style.css
```

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Установка и настройка](docs/INSTALL.md)
- [Эксплуатация и тестирование](docs/OPERATIONS.md)
- [Несколько Server2 и приоритеты](docs/MULTI_EXIT.md)
- [Генерация AWG 3.0/3.1](docs/AWG3.md)
- [Руководство конфигуратора](configurator/README.md)
- [Безопасность публикации](docs/SECURITY.md)
- [Список placeholders](docs/VARIABLES.md)
- [Краткий индекс полного руководства](FULL_GUIDE.md)
- [English README](README.en.md)

## Проверка отказоустойчивости

На Server2:

```bash
systemctl stop wg-quick@wg-exit
```

Ожидается:

```text
BFD DOWN
  ↓
BIRD удаляет default из table 200
  ↓
vpn-exit-monitor очищает VPN conntrack
  ↓
новые соединения выходят через Server1
```

Возврат:

```bash
systemctl start wg-quick@wg-exit
```

Ожидается автоматический failback через Server2.

## Синхронизация русской и английской документации

Русский `README.md` — основной документ. Английский `README.en.md` — полный перевод. Во всех разделах `docs/` и `configurator/` файл без языкового суффикса содержит русский текст, а `.en.md` — английский.

**При каждом изменении функционала обе версии должны обновляться в одном наборе изменений.**

Новый функционал считается документированным только если:

1. он описан в русском README;
2. он описан в английском README;
3. при необходимости обновлены соответствующие файлы в `docs/` и `configs/`;
4. если изменение затрагивает генерируемую схему — одновременно обновлён `configurator/`.

## Безопасность

Никогда не коммитьте:

- WireGuard/AmneziaWG private keys;
- реальные production-пароли;
- API tokens;
- cloud credentials;
- необезличенные backup/export файлы;
- production-конфиги из `/etc/wireguard/` без проверки;
- реальные публичные IP-адреса, если их публикация не планировалась.

Перед публикацией смотрите [SECURITY.md](docs/SECURITY.md).

## Лицензия

Проект распространяется по свободной лицензии **MIT**. См. [LICENSE](LICENSE).

MIT выбрана как простая permissive-лицензия, подходящая для документации, конфигурационных примеров и небольших вспомогательных скриптов: разрешено использовать, изменять, копировать и распространять материалы проекта при сохранении copyright/license notice.
