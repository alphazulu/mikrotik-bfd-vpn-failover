# Установка и настройка

[English version](INSTALL.en.md)

Руководство предполагает, что на Server1 уже работает AmneziaWG-интерфейс `<AWG_IF>`, Server1 видит каждый Server2 через публичный интернет, все Server2 могут пересылать IPv4 в интернет, а на MikroTik установлен RouterOS 7. Во всех примерах используются заполнители вместо рабочих адресов и ключей.

## 1. Server2 — пакеты и пересылка IPv4

```bash
apt update
apt install -y wireguard bird2
cat >/etc/sysctl.d/90-vpn-router.conf <<'SYSCTL'
net.ipv4.ip_forward=1
SYSCTL
sysctl --system
```

## 2. Server2 — wg-exit

Создайте `/etc/wireguard/wg-exit.conf` по примеру `configs/server2/wg-exit.conf.example`.

- Server2 слушает `<WG_EXIT_PORT>/udp`. Генерируемый конфиг явно разрешает этот порт в `INPUT` на `<SERVER2_WAN_IF>`.
- `AllowedIPs` peer Server1 включает туннельный адрес Server1 и все клиентские VPN-сети за ним.
- `PostUp`/`PostDown` сохраняют разрешение `FORWARD` для `wg-exit`, открывают внешний UDP-порт WireGuard и внутренний порт single-hop BFD UDP/3784 в `INPUT`.
- Образец также разрешает установленный обратный трафик в `wg-exit`.
- Правила `MASQUERADE` для конкретных клиентских подсетей добавляются и удаляются вместе с `wg-exit`.
- Необязательные `MTU` и `PresharedKey` можно использовать; PSK на двух сторонах должен совпадать.

Включите и проверьте:

```bash
systemctl enable --now wg-quick@wg-exit
wg show wg-exit
ip -br addr show wg-exit
ip route
```

## 3. Server2 — NAT и forwarding

Образец `wg-exit.conf.example` содержит правила пересылки и `MASQUERADE` для `<AWG_NET>`. При использовании `<WG_IN_NET>` добавьте необязательные правила NAT из комментариев образца или воспользуйтесь браузерным конфигуратором — он создаёт их сам.

Такой подход не добавляет широкое правило `POSTROUTING -o <SERVER2_WAN_IF> -j MASQUERADE` для всего остального трафика хоста.

## 4. Server2 — BIRD как ответчик BFD

Создайте `/etc/bird/bird.conf` из `configs/server2/bird.conf.example` и настройте доступ BIRD к файлу:

```bash
chown root:bird /etc/bird/bird.conf
chmod 640 /etc/bird/bird.conf
chmod 755 /etc/bird
bird -p -c /etc/bird/bird.conf
systemctl enable bird
systemctl restart bird
birdc show protocols
birdc show bfd sessions
```

## 5. Server1 — пакеты и sysctl

```bash
apt update
apt install -y wireguard bird2 conntrack
cat >/etc/sysctl.d/90-vpn-router.conf <<'SYSCTL'
net.ipv4.ip_forward=1
SYSCTL
sysctl --system
```

При policy routing не используйте строгую проверку обратного пути:

```bash
cat >/etc/sysctl.d/91-vpn-rpf.conf <<'SYSCTL'
net.ipv4.conf.all.rp_filter=2
net.ipv4.conf.default.rp_filter=2
SYSCTL
sysctl --system
```

## 5.1. Server1 — сгенерированный AWG 3.x

Режим конфигуратора **Generate new AWG/WG configs** создаёт:

```text
server1/<AWG_IF>.conf
clients/<AWG_IF>-client.conf
```

По умолчанию используется AWG 3.1. Для файла нужны инструменты AmneziaWG с поддержкой полей AWG 3.x: стандартный WireGuard `wg-quick` не понимает `HeaderProtectionKey`, `ContentPaddingAddition`, `RandomTrailers` и другие поля AWG.

После установки совместимых инструментов и проверки файла поместите `server1/<AWG_IF>.conf` в `/etc/amnezia/amneziawg/<AWG_IF>.conf`, задайте режим 600 и включите `awg-quick@<AWG_IF>`. Команды включены в сгенерированный `INSTALL.txt`. Если существующий AWG-конфиг импортирован, сохраните его текущий порядок запуска.

Используйте актуальные `amneziawg-tools` вместе с совместимым актуальным `amneziawg-go` либо kernel module AWG 3.1. Старая версия модуля может создать интерфейс, но отклонить его настройку новым userspace-инструментом.

Для AWG 3.1 генератор выдаёт:

```text
S1=S2=S3=S4=12
H1=1 H2=2 H3=3 H4=4
HeaderProtectionKey=<32-byte base64 key>
ContentPaddingAddition=10-100
RekeyAfterTime=100-120
RekeyTimeout=3-7
RejectAfterTime=150-180
KeepaliveTimeout=5-15
MaxHandshakeAttempts=15-20
RandomTrailers=on
DisableCookies=on
```

На клиенте генерируется `PersistentKeepalive=25-35`. Совместимость версий и правила проверки описаны в [AWG 3.x](AWG3.md).

## 6. Server1 — интерфейсы wg-exit

Для одного Server2 создайте `/etc/wireguard/wg-exit.conf` из `configs/server1/wg-exit.conf.example`. Для нескольких Server2 нужен отдельный интерфейс и отдельная транзитная подсеть на каждый выход:

```text
/etc/wireguard/wg-exit.conf
/etc/wireguard/wg-exit2.conf
/etc/wireguard/wg-exit3.conf
```

Чем меньше числовой приоритет Server2, тем предпочтительнее выход. Полная схема: [несколько Server2](MULTI_EXIT.md). Критически важное значение в конфиге:

```ini
Table = off
```

Если в импортируемой паре WireGuard задан `PresharedKey` или нестандартный `MTU`, сохраните их на обеих соответствующих сторонах.

Включите все сгенерированные интерфейсы:

```bash
systemctl enable --now wg-quick@wg-exit
systemctl enable --now wg-quick@wg-exit2
# ...
```

## 6.1. Генерация межсерверного WireGuard

В конфигураторе отдельно выбирается источник **Inter-server WG source**. Вариант **Generate Server1 ↔ Server2 wg-exit configs** создаёт туннели локально без импорта готовых `wg-exit.conf`.

Для каждого выхода создаются пары приватного и открытого X25519-ключа Server1 и Server2, при необходимости отдельный PSK и отдельная сеть `/30`, если поля адресов пусты. Публичный endpoint Server2 нужно указать вручную. Приоритет, UDP-порт, WAN-интерфейс, MTU и имя интерфейса доступны для изменения.

Генерируются как основной, так и дополнительные выходы; результат устанавливается так же, как импортированные файлы:

```text
server1/wg-exit.conf
server1/wg-exit2.conf
...
server2/wg-exit.conf
server2-2/wg-exit.conf
...
```

## 7. Server1 — policy routing

С одним выходом сохраняется правило:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
```

При нескольких выходах конфигуратор создаёт цепочку, например с начальной таблицей 200:

```bash
ip rule add priority 1000 iif <AWG_IF> lookup 200
ip rule add priority 1001 iif <AWG_IF> lookup 201
ip rule add priority 1002 iif <AWG_IF> lookup 202
```

Server2 с минимальным числовым приоритетом получает первую таблицу. Если в ней нет default от BIRD, Linux пробует следующее правило и следующий Server2.

Для дополнительного входящего WireGuard при одном выходе:

```bash
ip rule add priority 1001 iif <WG_IN_IF> lookup 200
```

Полный сгенерированный `wg-in.conf` сохраняет это правило через собственные `PostUp`/`PreDown`. Если заданы только сеть и имя интерфейса, правило может сохранять systemd unit policy routing.

## 8. Server1 — дополнительный wg-in

Конфигуратор может создать `server1/wg-in.conf` с адресом и портом Server1, приватным ключом, открытым ключом peer, необязательным PSK и `AllowedIPs` peer. Он также включает `PostUp`/`PreDown` для тех же выходных таблиц, что у `awg0` (при одном выходе priority `1001`, при нескольких — отдельный диапазон), изоляцию клиентов на одном интерфейсе, разрешение пересылки и установленного обратного трафика.

Установите файл как `/etc/wireguard/<WG_IN_IF>.conf` и включите:

```bash
systemctl enable --now wg-quick@<WG_IN_IF>
```

## 9. Server1 — резервный NAT

Установите `configs/server1/vpn-failover-firewall.service.example` как `/etc/systemd/system/vpn-failover-firewall.service`. Конфигуратору нужен реальный `ListenPort` AWG на Server1 для разрешения UDP в `INPUT` со стороны WAN: при импорте AWG-файла он считывается автоматически, при ручном вводе его нужно указать.

Замените placeholders и включите unit:

```bash
systemctl daemon-reload
systemctl enable --now vpn-failover-firewall.service
```

Unit добавляет резервный `MASQUERADE` для клиентских сетей, правила `FORWARD` на Server1 и разрешения `INPUT` для внешних портов AWG и при наличии `wg-in`, BFD UDP/3784 от MikroTik на `<AWG_IF>` и от каждого Server2 на соответствующем `wg-exit*`. Комментарии позволяют unit удалять только собственные правила.

## 10. Server1 — BIRD

Для одного выхода используйте `configs/server1/bird.conf.example` как `/etc/bird/bird.conf`; для нескольких — конфигуратор или `configs/server1/bird-multi-exit.conf.example`.

У каждого Server2 собственная таблица BIRD, статический default под контролем BFD и таблица Linux:

```text
highest priority -> exit4_1 -> table 200
next priority    -> exit4_2 -> table 201
next priority    -> exit4_3 -> table 202
```

Маршрут совместим с BIRD 2.14:

```bird
route 0.0.0.0/0 via <WG_EXIT_S2_IP> bfd;
```

Проверка:

```bash
bird -p -c /etc/bird/bird.conf
birdc configure
birdc show bfd sessions
iptables -S INPUT | grep 3784
birdc show route table exit4
ip route show table 200
```

При BFD UP в таблице 200 ожидается default через `wg-exit`.

## 11. Server1 — монитор conntrack

Установите `configs/server1/vpn-exit-monitor.sh` в `/usr/local/sbin/vpn-exit-monitor.sh`, а `configs/server1/vpn-exit-monitor.service` — в `/etc/systemd/system/`:

```bash
chmod 755 /usr/local/sbin/vpn-exit-monitor.sh
systemctl daemon-reload
systemctl enable --now vpn-exit-monitor.service
journalctl -t vpn-exit-monitor -f
```

Сервис слушает события маршрутов Netlink через `ip monitor route`. Он определяет текущий выбранный выход по таблицам в порядке приоритетов и очищает conntrack VPN-подсетей только при смене выбранного пути. События резервного выхода, пока основной остаётся доступен, очистку не запускают.

### Условия fallback в RouterOS

Для режима address-list + mangle предполагается стандартный порядок:

```text
mangle -> vrf-lookup -> vrf-unreach -> local -> user -> main
```

Отдельная таблица (например, `VPN`) создаётся с `fib` до ссылки на неё через `new-routing-mark`; в ней должен быть только управляемый BFD default. Если он выключен, поиск продолжится по явному правилу:

```routeros
/routing rule
add action=lookup routing-mark=VPN table=main comment="VPN_BFD_FALLBACK"
```

Не заменяйте `lookup` на `lookup-only-in-table`. Удалите прежний резервный default в самой таблице `VPN`, например маршрут к обычному WAN с `distance=2`: иначе поиск завершится в `VPN` и fallback к `main` не сработает. При изменённом `/routing/settings policy-rules` проверьте, что `mangle` предшествует `user/main` и `main` остаётся доступен.

## 12. MikroTik — BFD к Server1

Используйте обезличенный пример `configs/mikrotik/bfd-failover.rsc.example`. Для туннельного адреса `/32`:

```routeros
/ip address
add address=<AWG_MIKROTIK_IP>/32 network=<AWG_SERVER_IP> interface=<MT_AWG_IF>
```

Firewall MikroTik должен пропускать BFD-пакеты к самому роутеру. Генерируемый `.rsc` добавляет узкое правило `chain=input protocol=udp dst-port=3784` для направления `<AWG_SERVER_IP> -> <AWG_MIKROTIK_IP>` на `<MT_AWG_IF>` перед первым существующим правилом `INPUT drop`, если оно есть.

Выберите один из режимов:

- **Address-list + mangle:** отдельная таблица, маршрут с `check-gateway=bfd`, метка маршрутизации с именем таблицы (например, `VPN`) и `/routing rule action=lookup routing-mark=<table> table=main` для fallback. Доступна выборочная очистка `CM_VPN` conntrack. Общие fasttrack-правила ограничиваются `connection-mark=no-mark`. При переходе со старой схемы удалите резервный default с `distance=2` из отдельной таблицы после добавления правила fallback.
- **Прямые маршруты:** нужные префиксы создаются в `main` через шлюз AWG с `check-gateway=bfd`, без mangle и меток соединений.

Во втором режиме генератор не очищает выборочно старые соединения MikroTik: метки для их отбора нет.

## 13. Функциональная проверка

Для одного выхода действует обычная проверка. Для нескольких посмотрите состояние всех таблиц:

```bash
birdc show bfd sessions
ip rule
ip route show table 200
ip route show table 201
ip route show table 202
journalctl -t vpn-exit-monitor -f
```

Остановите `wg-exit` на самом приоритетном Server2. Ожидается: BFD этого выхода перейдёт в DOWN, default пропадёт только в его таблице, policy routing выберет следующий Server2 и из-за смены действующего выхода очистится VPN conntrack. При возвращении более приоритетного Server2 должен произойти автоматический failback.

Повторяйте до недоступности всех Server2: последним резервным путём должны стать таблица `main` и WAN Server1. Подробная процедура: [проверка нескольких выходов](MULTI_EXIT.md).
