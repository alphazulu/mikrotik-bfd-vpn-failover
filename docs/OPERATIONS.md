# Эксплуатация, проверка и диагностика

[English version](OPERATIONS.en.md)

## Регулярные проверки

### Server1

```bash
wg show
birdc show bfd sessions
birdc show protocols bgp_mt
ip rule
ip route show table 200
# при дополнительных выходах:
ip route show table 201
ip route show table 202
systemctl is-active wg-quick@wg-exit bird vpn-exit-monitor
```

### Server2

```bash
wg show wg-exit
birdc show bfd sessions
sysctl net.ipv4.ip_forward
iptables -S FORWARD
iptables -t nat -S POSTROUTING
```

### MikroTik

```routeros
/routing bfd session print detail
/routing bgp session print detail
/routing route print detail where routing-table=VPN bgp=yes
```

## События маршрута на Server1

На MikroTik в таблице `VPN` должен появляться динамический BGP-маршрут к анонсируемому префиксу. При отключении AWG/BFD или падении BGP-сессии он исчезает, и правило `VPN_BFD_FALLBACK` направляет новые соединения через `main`. В direct mode проверяйте маршруты в `main`; запрос `0.0.0.0/0` превращается в два анонса `/1`.

При потере Server2 ожидается удаление маршрута:

```text
Deleted default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird metric 32
```

При восстановлении:

```text
default via <WG_EXIT_S2_IP> dev wg-exit table 200 proto bird metric 32
```

Наблюдение:

```bash
ip -ts monitor route
journalctl -t vpn-exit-monitor -f
```

## Что проверяет BFD

Не заменяйте BFD для каждого выхода рекурсивным маршрутом к произвольному публичному адресу, пока топология остаётся следующей:

```text
MikroTik -> интернет -> Server1
Server1  -> интернет -> публичный WireGuard endpoint каждого Server2
```

В такой схеме BFD проходит через тот же путь, который нужен туннелю до Server2. Сторонний публичный probe добавит ещё одну область отказа. Если появится частный транспорт до Server2 или потребуется отдельно проверять NAT и доступность произвольных внешних адресов, добавьте сквозную проверку и явно опишите её критерий.

## Диагностика BFD и WireGuard

```bash
birdc show bfd sessions
tcpdump -ni wg-exit -vvv udp port 3784
tcpdump -ni <AWG_IF> -vvv udp port 3784
tcpdump -ni <AWG_IF> -vvv tcp port 179
wg show wg-exit
```

Для single-hop BFD обычно ожидается TTL 255. В `wg show` проверьте время последнего handshake, счётчики, endpoint и AllowedIPs. Интерфейс WireGuard может оставаться административно UP при недоступном peer: его доступность определяет BFD.

## Сохранение правил firewall

При политике `FORWARD DROP` на Server2 оставьте в `wg-exit.conf`:

```ini
PostUp = iptables -I FORWARD 1 -i %i -j ACCEPT
PostDown = iptables -D FORWARD -i %i -j ACCEPT
```

## Проверки после перезагрузки

По очереди перезагрузите: 1) только Server1; 2) только Server2; 3) оба в одном окне обслуживания; 4) Server1 при недоступном Server2; 5) позднее Server2 и проверьте автоматическое возвращение на него.

После каждого сценария:

```bash
birdc show bfd sessions
ip route show table 200
```

## Conntrack, MTU и таймеры

Server1 очищает только соединения с адресами источника из заданных клиентских VPN-подсетей. MikroTik удаляет только соединения с меткой `CM_VPN`.

Если ICMP работает, но HTTPS/TCP зависает, проверьте PMTU/MSS:

```bash
ping -M do -s <SIZE> <REMOTE_IP>
tracepath <REMOTE_IP>
```

Начальный интервал BFD — 500 мс на отправку и приём, multiplier 3. Уменьшайте интервалы только при подтверждённой необходимости.

## Тест нескольких выходов

Проверяйте всю цепочку приоритетов, включая переход к WAN Server1:

```text
table 200 -> priority 1
table 201 -> priority 2
table 202 -> priority 3
main      -> WAN Server1
```

Текущее состояние:

```bash
birdc show bfd sessions
ip rule
ip route show table 200
ip route show table 201
ip route show table 202
journalctl -t vpn-exit-monitor -f
```

Остановите `wg-exit` на самом приоритетном Server2. Новые соединения должны перейти к следующей таблице. Повторяйте, пока не останется доступных Server2, затем проверьте выход через WAN Server1.

Восстановите Server2 также в порядке, не совпадающем с приоритетами. Выбранным должен стать доступный выход с наименьшим числовым приоритетом. Падение и восстановление резервного Server2 при работающем основном не должно вызывать запись `Selected VPN exit changed` и очистку VPN conntrack.

## Примечание для scheduler RouterOS 7.24.x

Скрипт `VPN-BFD-Conntrack` не использует пустой `:return`: в RouterOS 7.24.x ему требуется значение, иначе scheduler сообщает:

```text
Script Error: missing value(s) of argument(s) value
```

Для раннего выхода применяются вложенные `:if ... else={...}`. Начальное состояние запоминается без очистки. Раз в секунду скрипт ищет в таблице `VPN` активный BGP-маршрут к настроенному префиксу; при его появлении или исчезновении очищает только соединения с меткой `CM_VPN`. Другие маршруты таблицы и текстовое представление gateway не влияют на проверку. В direct mode этот планировщик не создаётся.

`start-time=startup` после импорта на работающем роутере не выполняется до следующей перезагрузки. Генератор поэтому берёт текущее время, прибавляет две секунды (с переносом минуты, часа и полуночи) и один раз запускает `VPN-BFD-Conntrack` ещё в `.rsc`. Первый проход обычно только запоминает `DOWN` или `UP`. Повторный импорт обновляет запись `/routing bfd configuration` с `comment="VPN_BFD"`, а не добавляет вторую.
