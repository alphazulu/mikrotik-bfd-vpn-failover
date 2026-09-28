# Несколько Server2 и приоритетный failover

[English version](MULTI_EXIT.en.md)

Проект поддерживает несколько выходных Server2 одновременно.

Server1 поднимает **отдельный WireGuard-интерфейс к каждому Server2**:

```text
MikroTik / VPN clients
        |
        v
      Server1
        |
        +-- wg-exit  ----> Server2-A   priority 10
        |
        +-- wg-exit2 ----> Server2-B   priority 20
        |
        +-- wg-exit3 ----> Server2-C   priority 30
        |
        +---------------> Server1 WAN / main
```

Меньшее числовое значение означает более высокий приоритет.

## Почему отдельный WireGuard-интерфейс на каждый Server2

Каждый выходной peer должен принимать `AllowedIPs = 0.0.0.0/0` со стороны Server1.

Несколько peers с одинаковым `0.0.0.0/0` на одном WireGuard-интерфейсе не дают однозначного выбора peer для исходящего пакета. Поэтому проект использует отдельный интерфейс на каждый выход:

```text
wg-exit
wg-exit2
wg-exit3
...
```

Для каждого интерфейса используется собственная point-to-point transfer subnet.

## Как задаётся приоритет

Пусть в конфигураторе указаны:

| Server2 | Priority | Server1 interface |
|---|---:|---|
| Server2-A | 10 | `wg-exit` |
| Server2-B | 20 | `wg-exit2` |
| Server2-C | 30 | `wg-exit3` |

Если базовая Linux routing table равна `200`, конфигуратор назначит:

```text
priority 10 -> table 200
priority 20 -> table 201
priority 30 -> table 202
```

Сами числовые значения priority могут быть любыми положительными целыми. Важен их порядок. Одинаковые priority запрещены.

## Linux policy routing

Для `awg0` Server1 получает последовательность правил:

```bash
ip rule add priority 1000 iif awg0 lookup 200
ip rule add priority 1001 iif awg0 lookup 201
ip rule add priority 1002 iif awg0 lookup 202
```

Linux проверяет таблицы по порядку.

Если в table `200` BFD-маршрут отсутствует, lookup продолжается в table `201`. Если там также нет маршрута — в table `202`. Если ни один Server2 не доступен, обработка доходит до обычного `main`, и трафик выходит через WAN Server1.

Для дополнительного `wg-in` генерируется аналогичная последовательность правил с отдельным диапазоном priority.

## Почему достаточно отдельной BFD-сессии на каждый Server2

В этой архитектуре каждый Server2 доступен с Server1 через Internet по своему публичному WireGuard endpoint. То есть BFD внутри `wg-exit*` проходит поверх того же Internet-path, который нужен для самого межсерверного соединения.

Поэтому состояние каждого выхода определяется независимо:

```text
Internet-path до Server2-A + wg-exit  + BFD UP -> exit A доступен
Internet-path до Server2-B + wg-exit2 + BFD UP -> exit B доступен
Internet-path до Server2-C + wg-exit3 + BFD UP -> exit C доступен
```

Дополнительный recursive route через внешний ping-host здесь намеренно не используется: он добавил бы стороннюю контрольную точку и проверял бы не тот конкретный путь, по которому построен `wg-exit`. Если в будущем Server2 будет доступен через приватную underlay-сеть или понадобится отдельно контролировать NAT/произвольный внешний Internet target, это допущение надо пересмотреть.

## BIRD

На Server1 каждому Server2 соответствует собственная BIRD IPv4 table и отдельный Linux kernel table.

Пример для трёх выходов:

```text
exit4_1 -> Linux table 200 -> wg-exit
exit4_2 -> Linux table 201 -> wg-exit2
exit4_3 -> Linux table 202 -> wg-exit3
```

Каждый default route имеет атрибут `bfd`.

Таким образом BFD-сессии независимы:

```text
Server2-A DOWN -> default исчезает только из table 200
Server2-B DOWN -> default исчезает только из table 201
Server2-C DOWN -> default исчезает только из table 202
```

Отказ резервного Server2 не влияет на активный путь, пока более приоритетный выход остаётся доступен.

## Firewall для BFD

Каждая BFD-сессия — это локальный control-plane traffic, поэтому она должна быть разрешена в `INPUT`.

Конфигуратор добавляет на Server1 отдельный UDP/3784 INPUT allow для каждого `wg-exit*`, ограниченный точными tunnel IP Server1/Server2. На каждом Server2 соответствующий `wg-exit.conf` добавляет INPUT allow для BFD от Server1, а также allow для публичного WireGuard listen port.

Отказ одного backup-выхода не требует открывать UDP/3784 глобально: правила создаются отдельно для каждого интерфейса и peer.

## Conntrack

`vpn-exit-monitor.sh` больше не реагирует на любое изменение любого BIRD route.

Он вычисляет **фактически выбранный выход** — первую routing table из списка приоритетов, в которой есть BIRD default route.

Conntrack VPN-клиентов очищается только если выбранный путь действительно изменился:

```text
Server2-A -> Server2-B
Server2-B -> Server2-C
Server2-C -> main
main      -> Server2-A
```

Если, например, Server2-C перезапустился, пока Server2-A остаётся активным, conntrack не очищается.

## Failback

Failback также следует priority order.

Например:

```text
A priority 10 - DOWN
B priority 20 - UP
C priority 30 - UP

selected = B
```

После возврата A:

```text
A priority 10 - UP

selected = A
```

Server1 автоматически возвращает новый трафик на A, а monitor очищает VPN conntrack один раз при фактической смене selected exit.

## Все Server2 недоступны

Если default route отсутствует во всех выделенных таблицах, Linux policy routing продолжает обработку правил и доходит до `main`.

Итоговый путь:

```text
VPN client
  -> Server1
  -> table 200: no route
  -> table 201: no route
  -> table 202: no route
  -> main
  -> Server1 WAN
  -> Internet
```

## Требования к каждому дополнительному Server2

Для каждого выхода нужны:

- уникальный priority;
- уникальное имя WireGuard-интерфейса на Server1;
- отдельная transfer subnet;
- Server1 tunnel address;
- Server2 tunnel address;
- Server2 public endpoint;
- UDP port;
- WireGuard key pair обеих сторон;
- optional PresharedKey;
- Server2 WAN interface;
- optional MTU.

Конфигуратор может импортировать Server1-side и Server2-side WireGuard configs для каждого дополнительного выхода.

## Сгенерированные файлы

Для двух Server2 пример структуры:

```text
server1/
  wg-exit.conf
  wg-exit2.conf
  bird.conf
  awg-policy-routing.service
  vpn-exit-monitor.sh
  vpn-exit-monitor.service
  ...

server2/
  wg-exit.conf
  bird.conf

server2-2/
  wg-exit.conf
  bird.conf
```

## Проверка

Для трёх выходов:

```bash
birdc show bfd sessions
ip rule
ip route show table 200
ip route show table 201
ip route show table 202
journalctl -t vpn-exit-monitor -f
```

Тестируйте последовательно:

1. отключить Server2 с самым высоким приоритетом;
2. убедиться, что выбран следующий;
3. отключить второй;
4. убедиться, что выбран третий;
5. отключить все Server2 и проверить fallback через Server1 WAN;
6. включать Server2 обратно в обратном порядке;
7. убедиться, что система автоматически возвращается на самый высокий доступный priority.
