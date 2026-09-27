# Генерация AmneziaWG 3.0 / 3.1

Конфигуратор поддерживает три профиля генерации AmneziaWG:

- **AWG 2.0** — предыдущий профиль;
- **AWG 3.0 compatibility** — Header Protection + timing/padding без `RandomTrailers` / `DisableCookies`;
- **AWG 3.1** — рекомендуемый и выбранный по умолчанию профиль.

## Важное замечание о версии 3.0

В текущем официальном коде AmneziaVPN маркер `awgV3` уже имеет значение `3.1`. Любой набор с `HeaderProtectionKey` или другими AWG3-параметрами определяется текущим клиентом как AWG 3.1.

Поэтому пункт **AWG 3.0 compatibility** в этом проекте — это совместимый профиль для более раннего набора 3.x-параметров, а не отдельный современный protocol ID.

## AWG 3.1 — генерируемые параметры

Конфигуратор использует совместимые с текущим self-hosted стеком значения:

```ini
Jc = <random 4..6>
Jmin = 10
Jmax = 50

S1 = 12
S2 = 12
S3 = 12
S4 = 12

H1 = 1
H2 = 2
H3 = 3
H4 = 4

HeaderProtectionKey = <random 32-byte base64 key>

ContentPaddingAddition = 10-100
RekeyAfterTime = 100-120
RekeyTimeout = 3-7
RejectAfterTime = 150-180
KeepaliveTimeout = 5-15
MaxHandshakeAttempts = 15-20

RandomTrailers = on
DisableCookies = on
```

В клиентском профиле:

```ini
PersistentKeepalive = 25-35
```

## Почему H1-H4 = 1/2/3/4

При включённом Header Protection текущая документация AmneziaWG рекомендует стандартные compatibility values:

```text
H1=1
H2=2
H3=3
H4=4
```

Тип сообщения скрывается Header Protection, поэтому отдельная рандомизация H не нужна.

Это также обходит известную проблему текущих AWG 3.1 реализаций: диапазоны H1-H3 вместе с `RandomTrailers=on` могут приводить к ошибочной классификации transport-пакетов и скрытым потерям.

Поэтому генератор **не создаёт ranged H** для AWG 3.x.

## Почему S1-S4 = 12

`HeaderProtectionKey` использует первые 12 байт соответствующего S-префикса как nonce. Поэтому при Header Protection каждый `S1-S4` должен быть не меньше 12.

Для AWG 3.1 также безопаснее использовать одинаковые значения S при `RandomTrailers=on`. Текущий генератор использует:

```text
S1=S2=S3=S4=12
```

## HeaderProtectionKey

Ключ:

- генерируется через `crypto.getRandomValues()`;
- имеет длину 32 байта;
- хранится в base64;
- одинаков на server/client конфигурациях;
- маскируется в preview вместе с PrivateKey/PresharedKey.

После скачивания bundle его необходимо считать секретом.

## CPS I1-I5

Параметры `I1-I5` доступны в Advanced-разделе, но по умолчанию остаются пустыми.

Причина: CPS должен имитировать конкретный протокол, а общий статический шаблон для всех установок сам становится узнаваемой сигнатурой. Кроме того, разные версии `awg-quick` исторически имели различия при разборе CPS-строк.

Если `I1-I5` заданы вручную, они добавляются в клиентский AWG config. Server-side config их намеренно не генерирует, что соответствует текущей self-hosted схеме Amnezia.

## AWG 3.0 compatibility

Этот профиль генерирует:

- `HeaderProtectionKey`;
- `ContentPaddingAddition`;
- `RekeyAfterTime`;
- `RekeyTimeout`;
- `RejectAfterTime`;
- `KeepaliveTimeout`;
- `MaxHandshakeAttempts`;
- `S1-S4=12`;
- `H1-H4=1/2/3/4`.

Он **не** добавляет:

```ini
RandomTrailers =
DisableCookies =
```

и, как другие AWG 3.x профили в текущем клиенте, использует диапазон:

```ini
PersistentKeepalive = 25-35
```

Для новых установок предпочтителен профиль AWG 3.1.

## Runtime

Для AWG 3.x нужен runtime/toolchain, который понимает новые поля конфигурации:

- актуальный `amneziawg-tools`;
- актуальный `amneziawg-go` либо совместимый AWG 3.1 kernel module.

Не смешивайте новый `awg/awg-quick` со старым kernel module: возможна ситуация, когда интерфейс создаётся, но `awg setconf` завершается `Invalid argument`.

Для AWG 3.1 рекомендуется использовать актуальный релиз 3.1 стека, а не ранние сборки.

## Проверка

После установки:

```bash
awg show
awg-quick strip <config>
```

Проверьте, что server и client имеют одинаковые:

```text
HeaderProtectionKey
H1-H4
S1-S4
RandomTrailers
DisableCookies
```

и что ключи peer соответствуют друг другу.
