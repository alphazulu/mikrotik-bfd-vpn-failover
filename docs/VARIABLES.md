# Справочник placeholders

[English version](VARIABLES.en.md)

В документации и публичном репозитории вместо рабочих данных используйте заполнители. Значения переменных:

| Placeholder | Значение |
|---|---|
| `<SERVER1_PUBLIC_IP>` | Публичный IPv4 Server1 |
| `<SERVER2_PUBLIC_IP>` | Публичный IPv4 выходного Server2 |
| `<SERVER2_N_PUBLIC_IP>` | Публичный IPv4 дополнительного Server2 с номером N |
| `<SERVER2_PRIORITY>` | Числовой приоритет выхода: меньшее число предпочтительнее |
| `<SERVER1_WAN_IF>` | Интернет-интерфейс Server1, например `eth0` |
| `<LINUX_POLICY_TABLE>` | Linux-таблица для VPN-клиентов в схеме с одним выходом |
| `<LINUX_POLICY_TABLE_BASE>` | Первая Linux-таблица для выходов по приоритету, обычно `200` |
| `<SERVER2_WAN_IF>` | Интернет-интерфейс Server2, например `eth0` |
| `<AWG_LISTEN_PORT>` | Внешний UDP-порт входящего AmneziaWG на Server1 |
| `<AWG_IF>` | Интерфейс AmneziaWG на Server1, обычно `awg0` |
| `<AWG_NET>` | Клиентская сеть за `awg0` |
| `<AWG_SERVER_IP>` | Адрес Server1 внутри AmneziaWG |
| `<AWG_MIKROTIK_IP>` | Адрес MikroTik внутри AmneziaWG |
| `<AWG_PROFILE>` | Генерируемый профиль AWG: `2.0`, совместимость `3.0` или `3.1` |
| `<AWG_HEADER_PROTECTION_KEY>` | Секретный 32-байтовый ключ AWG 3.x HeaderProtectionKey, одинаковый на обеих сторонах |
| `<AWG_CONTENT_PADDING_ADDITION>` | Диапазон AWG 3.x для добавочного padding, например `10-100` |
| `<AWG_REKEY_AFTER_TIME>` | Интервал или диапазон AWG 3.x для rekey |
| `<AWG_REKEY_TIMEOUT>` | Тайм-аут или диапазон AWG 3.x для rekey |
| `<AWG_REJECT_AFTER_TIME>` | Интервал или диапазон AWG 3.x для reject-after |
| `<AWG_KEEPALIVE_TIMEOUT>` | Тайм-аут или диапазон AWG 3.x для keepalive |
| `<AWG_MAX_HANDSHAKE_ATTEMPTS>` | Максимальное количество или диапазон попыток handshake AWG 3.x |
| `<AWG_RANDOM_TRAILERS>` | Переключатель AWG 3.1, обычно `on` |
| `<AWG_DISABLE_COOKIES>` | Переключатель AWG 3.1, обычно `on` |
| `<MT_AWG_IF>` | Совместимый с AmneziaWG/WireGuard интерфейс MikroTik |
| `<MT_ROUTE_TABLE>` | Отдельная таблица RouterOS для policy mode, отличная от `main` |
| `<DST_ADDRESS_LIST>` | Существующий `dst-address-list` RouterOS, выбирающий VPN-путь |
| `<WAN_INTERFACE_LIST>` | Список WAN-интерфейсов RouterOS, исключённых из маркировки |
| `<WG_EXIT_IF>` | Выходной WireGuard-интерфейс Server1, например `wg-exit`, `wg-exit2` |
| `<WG_EXIT_NET>` | Уникальная для Server2 транзитная сеть WireGuard |
| `<WG_EXIT_S1_IP>` | Адрес Server1 в `wg-exit` |
| `<WG_EXIT_S2_IP>` | Адрес Server2 в `wg-exit` |
| `<WG_EXIT_PORT>` | Слушающий UDP-порт Server2 |
| `<WG_EXIT_MTU>` | Необязательный MTU для `wg-exit`, если нужен нестандартный |
| `<WG_EXIT_PRESHARED_KEY>` | Необязательный секретный PresharedKey WireGuard, одинаковый у двух peers |
| `<WG_IN_NET>` | Необязательная сеть клиентов второго входящего WireGuard на Server1 |
| `<WG_IN_LISTEN_PORT>` | Необязательный внешний UDP-порт дополнительного входящего WireGuard на Server1 |
| `<WG_IN_IF>` | Необязательный входящий WireGuard-интерфейс Server1 |
| `<WG_IN_SERVER_ADDRESS>` | Необязательный адрес с префиксом Server1 на `wg-in` |
| `<WG_IN_PORT>` | Необязательный слушающий UDP-порт `wg-in` |
| `<WG_IN_PRIVATE_KEY>` | Необязательный приватный ключ Server1 для `wg-in`: реальное значение нельзя коммитить |
| `<WG_IN_PEER_PUBLIC_KEY>` | Открытый ключ peer для `wg-in` |
| `<WG_IN_PEER_ALLOWED_IPS>` | Необязательный `AllowedIPs` peer для `wg-in` |
| `<WG_IN_PRESHARED_KEY>` | Необязательный PresharedKey для `wg-in` |
| `<SERVER1_WG_EXIT_PRIVATE_KEY>` | Приватный ключ Server1: реальное значение нельзя коммитить |
| `<SERVER1_WG_EXIT_PUBLIC_KEY>` | Открытый ключ Server1 |
| `<SERVER2_WG_EXIT_PRIVATE_KEY>` | Приватный ключ Server2: реальное значение нельзя коммитить |
| `<SERVER2_WG_EXIT_PUBLIC_KEY>` | Открытый ключ Server2 |

В примерах можно использовать произвольные частные адреса, но для публичного репозитория безопаснее placeholders.

## Несколько выходов

Для нескольких Server2 обозначайте значения с номером выхода:

```text
<WG_EXIT_IF_1>, <WG_EXIT_NET_1>, <WG_EXIT_S1_IP_1>, <WG_EXIT_S2_IP_1>
<WG_EXIT_IF_2>, <WG_EXIT_NET_2>, <WG_EXIT_S1_IP_2>, <WG_EXIT_S2_IP_2>
...
```

Конфигуратор сортирует выходы по `<SERVER2_PRIORITY>` и назначает им таблицы Linux начиная с `<LINUX_POLICY_TABLE_BASE>`.
