# Руководство проекта

Основная документация проекта ведётся на русском языке. В каждом разделе адрес без суффикса открывает русский текст, `.en.md` — английский перевод:

- [Русская версия README](README.md)
- [English version](README.en.md)

Обе версии должны обновляться синхронно при каждом изменении функционала.

Подробные технические материалы разбиты на отдельные документы:

1. [Архитектура](docs/ARCHITECTURE.md)
2. [Установка и настройка](docs/INSTALL.md)
3. [Эксплуатация и тестирование](docs/OPERATIONS.md)
4. [AWG 3.0/3.1 — генерация](docs/AWG3.md)
5. [AWG 3.0/3.1 generation](docs/AWG3.en.md)
6. [Несколько Server2 и приоритетный failover](docs/MULTI_EXIT.md)
7. [Multiple Server2 exits and prioritized failover](docs/MULTI_EXIT.en.md)
8. [Переменные и placeholders](docs/VARIABLES.md)
9. [Безопасность публикации](docs/SECURITY.md)
10. [Руководство конфигуратора](configurator/README.md)

Готовые обезличенные примеры конфигураций находятся в каталоге `configs/`.

В репозитории не должны появляться реальные production IP-адреса, приватные ключи, пароли, токены и идентифицирующие инфраструктуру данные.


## Онлайн-конфигуратор

Локальный браузерный генератор находится в каталоге [configurator/](configurator/) и публикуется через GitHub Pages:

https://alphazulu.github.io/mikrotik-bfd-vpn-failover/

Приложение не имеет backend, внешних runtime-зависимостей или аналитики. CSP запрещает исходящие соединения приложения через `connect-src 'none'`. Импортированные конфиги и ключи существуют только в памяти вкладки и используются для локальной генерации файлов.


## Несколько Server2

Расширенная схема позволяет Server1 одновременно держать несколько независимых WireGuard/BFD выходов через разные Server2. Выходы сортируются по numeric priority, каждому назначается отдельная Linux routing table, а policy routing пробует их по порядку перед fallback в `main`.

Подробности: [docs/MULTI_EXIT.md](docs/MULTI_EXIT.md).
