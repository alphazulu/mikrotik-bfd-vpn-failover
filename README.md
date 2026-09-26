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
- BIRD 2.x для автоматического добавления/удаления default route;
- упорядоченный Linux policy routing через table `200`, `201`, `202`, ... согласно priority Server2;
- автоматический переход Server2 → следующий Server2 → WAN Server1;
- автоматический failback на самый приоритетный доступный Server2;
- event-driven очистка Linux conntrack через Netlink route events;
- BFD между MikroTik и Server1 внутри AmneziaWG;
- `check-gateway=bfd` на MikroTik;
- очистка только соединений с `connection-mark=CM_VPN` при смене состояния маршрута;
- сохранение работоспособности после перезагрузок Server1/Server2.

## Онлайн-конфигуратор

Для проекта добавлен локальный браузерный конфигуратор:

**https://alphazulu.github.io/mikrotik-bfd-vpn-failover/**

Он умеет:

- импортировать `wg-exit` конфигурации Server1 и Server2;
- добавлять дополнительные Server2, задавать каждому priority, отдельный Server1 WireGuard interface и импортировать обе стороны его туннеля;
- опционально импортировать входящий AWG-конфиг Server1 и отдельный `wg-in.conf`;
- автоматически извлекать внутренние tunnel IP, endpoint, UDP port, WireGuard keys, optional `PresharedKey` и MTU;
- проверять, что Server1/Server2 находятся в одной wg-exit подсети;
- проверять client subnet и BFD-параметры;
- генерировать готовые конфиги Server1, Server2 и MikroTik;
- генерировать optional `server1/wg-in.conf` с собственными `PostUp`/`PreDown` для `ip rule` и FORWARD;
- генерировать BIRD/BFD, Linux policy routing, systemd units, persistent Server1 FORWARD/fallback NAT и event-driven conntrack cleanup;
- формировать MikroTik `check-gateway=bfd` и очистку только `CM_VPN`;
- выбирать режим MikroTik: либо отдельная RouterOS routing table + `dst-address-list`/mangle, либо прямые статические маршруты в `main` без маркировки;
- скачивать отдельные файлы или весь комплект одним `.tar`;
- сохранять source-specific NAT/forwarding для Server2 в `wg-exit.conf`, а fallback NAT Server1 — в отдельном systemd unit.

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

Подробно: [Несколько Server2 и приоритетный failover](docs/MULTI_EXIT.ru.md).  
English: [Multiple Server2 exits and prioritized failover](docs/MULTI_EXIT.md).

### Режимы маршрутизации MikroTik

Конфигуратор поддерживает два варианта:

1. **Address-list + mangle.** Для выбранных `dst-address-list` создаются `mark-connection` и `mark-routing`, отдельная routing table и BFD-контролируемый маршрут. В этом режиме сохраняется selective cleanup соединений по `connection-mark`.
2. **Прямые маршруты.** Пользователь задаёт список IPv4/CIDR, а конфигуратор создаёт обычные static routes в `main` через AWG gateway с `check-gateway=bfd`. Mangle и connection marks не создаются. При BFD DOWN маршруты становятся неактивны и RouterOS использует другие подходящие маршруты, обычно обычный default route.

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
- `bash -n` для shell-скрипта conntrack monitor.

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

Это позволяет корректно использовать single-hop BFD и `check-gateway=bfd`.

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

MikroTik следит за BFD-маршрутом до Server1. Скрипт запоминает предыдущее состояние route и при переходах `UP ↔ DOWN` выполняет:

```routeros
/ip firewall connection remove [find where connection-mark="CM_VPN"]
```

Таким образом, при смене пути не приходится ждать таймаутов старых TCP/UDP/NAT states.

## Почему BFD, а не ping/Netwatch

BFD используется как основной liveness-механизм, потому что он:

- работает с короткими интервалами;
- не зависит от доступности стороннего Internet-host;
- контролирует непосредственно нужный туннельный peer;
- интегрирован с BIRD на Linux;
- может использоваться MikroTik через `check-gateway=bfd`.

Netwatch или отдельный ping-watchdog для этой схемы не требуется.

## Структура репозитория

```text
.
├── README.md
├── README.en.md
├── FULL_GUIDE.md
├── LICENSE
├── docs/
│   ├── ARCHITECTURE.md
│   ├── INSTALL.md
│   ├── OPERATIONS.md
│   ├── MULTI_EXIT.md
│   ├── MULTI_EXIT.ru.md
│   ├── SECURITY.md
│   └── VARIABLES.md
├── configs/
│   ├── mikrotik/
│   ├── server1/
│   └── server2/
└── configurator/
    ├── index.html
    ├── app.js
    └── style.css
```

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Установка и настройка](docs/INSTALL.md)
- [Эксплуатация и тестирование](docs/OPERATIONS.md)
- [Несколько Server2 и приоритеты](docs/MULTI_EXIT.ru.md)
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

`README.md` и `README.en.md` считаются двумя равноправными языковыми версиями основной документации.

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
