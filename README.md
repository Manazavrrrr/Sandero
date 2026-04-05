# PropChain — Decentralized Utility Billing on Solana

Децентрализованная система учёта и оплаты коммунальных услуг на блокчейне Solana.

C++ эмулятор умного счётчика считывает показания электроэнергии, записывает их в Solana смарт-контракт (Anchor), а Next.js фронтенд позволяет арендаторам оплачивать счета в USDC и инвесторам отслеживать доход.

```
┌──────────────┐     record_consumption()     ┌──────────────────┐     fetchApartment()     ┌──────────────┐
│  C++ Smart   │ ──────────────────────────►  │  Solana Program  │  ◄──────────────────────  │   Next.js    │
│  Meter       │     (Oracle keypair)         │  energy_meter    │     pay_utilities()       │   Frontend   │
│  Emulator    │                              │  (Anchor/Rust)   │  ──────────────────────►  │  (React)     │
└──────────────┘                              └──────────────────┘                           └──────────────┘
     1 tick/sec                                   PDA accounts                                Phantom Wallet
     ~1500W base                               GlobalConfig, Apartment                      Wallet Adapter
```

---

## Содержание

- [Архитектура](#архитектура)
- [Структура проекта](#структура-проекта)
- [Требования](#требования)
- [Установка и запуск](#установка-и-запуск)
  - [1. Solana Validator (localnet)](#1-solana-validator-localnet)
  - [2. Anchor контракт](#2-anchor-контракт)
  - [3. C++ эмулятор](#3-c-эмулятор)
  - [4. Next.js фронтенд](#4-nextjs-фронтенд)
- [Смарт-контракт](#смарт-контракт)
- [C++ эмулятор](#c-эмулятор-подробно)
- [Фронтенд](#фронтенд-подробно)
- [Переменные окружения](#переменные-окружения)
- [Типичные сценарии](#типичные-сценарии)

---

## Архитектура

### Участники системы

| Роль | Описание |
|------|----------|
| **Admin** | Деплоит контракт, создаёт `GlobalConfig`, регистрирует квартиры |
| **Oracle** | C++ программа с keypair — единственная, кто может вызвать `record_consumption` |
| **Tenant (Арендатор)** | Подключает Phantom Wallet, видит показания счётчика, оплачивает долг в USDC |
| **Investor (Инвестор)** | Владелец квартиры, получает 95% от каждой оплаты арендатора |

### Поток данных

1. **C++ эмулятор** тикает каждую секунду, симулируя потребление ~1500W (нормальное распределение + случайные пики).
2. Каждые N секунд (по умолчанию 10) эмулятор вызывает `record_consumption` в Solana контракте через Oracle-ключ.
3. Контракт прибавляет потребление к `accumulated_power` и рассчитывает долг: `unpaid_balance_usdc += amount * tariff`.
4. **Фронтенд** каждые 10 секунд читает `Apartment` PDA и отображает актуальные показания.
5. Арендатор нажимает "Оплатить" — вызывается `pay_utilities`, USDC переводится: 95% инвестору, 5% сервису.

---

## Структура проекта

```
проект/
├── backend/
│   ├── CMakeLists.txt              # Сборка C++ эмулятора
│   ├── include/
│   │   ├── smart_meter.hpp         # Заголовки: SmartMeter, MeterReading, BlockchainConfig
│   │   └── nlohmann/               # JSON библиотека (header-only)
│   ├── src/
│   │   ├── main.cpp                # Точка входа: CLI-парсинг, main loop, синхронизация
│   │   └── smart_meter.cpp         # Реализация: симуляция, blockchain bridge, PDA
│   ├── scripts/
│   │   ├── init_meter.sh           # Bash-обёртка: создание PDA квартиры
│   │   ├── init_meter.ts           # Anchor TS клиент: initialize
│   │   ├── sync_meter.sh           # Bash-обёртка: отправка показаний в контракт
│   │   ├── update_meter.ts         # Anchor TS клиент: update_meter_data
│   │   └── send_raw_instruction.ts # Отправка raw instruction через RPC
│   ├── anchor-contract/
│   │   ├── Anchor.toml             # Конфигурация Anchor (program ID, cluster)
│   │   ├── programs/
│   │   │   └── energy_meter/
│   │   │       ├── Cargo.toml      # Rust зависимости (anchor-lang 0.30, anchor-spl)
│   │   │       └── src/
│   │   │           └── lib.rs      # Смарт-контракт: 5 инструкций, 2 аккаунта, 8 ошибок
│   │   └── tests/
│   │       └── energy_meter.ts     # Тесты контракта (ts-mocha)
│   ├── package.json                # Node зависимости для скриптов
│   └── tsconfig.json
│
└── frontend/
    └── propchain/
        ├── app/
        │   ├── layout.js           # Root layout с WalletProvider
        │   ├── page.js             # Главная страница → Dashboard
        │   └── globals.css         # Глобальные стили
        ├── components/
        │   ├── Dashboard.jsx       # Основной UI: авторизация, арендатор, инвестор
        │   └── WalletProvider.jsx  # Solana Wallet Adapter провайдер (Phantom)
        ├── lib/
        │   ├── program.js          # Anchor клиент: PDA, fetch, payUtilities, хелперы
        │   └── idl/
        │       └── energy_meter.json  # IDL контракта для Anchor JS
        ├── .env.local.example      # Шаблон переменных окружения
        ├── next.config.mjs         # Конфиг Next.js 16 (Turbopack + webpack fallbacks)
        └── package.json
```

---

## Требования

### Обязательные

| Инструмент | Версия | Назначение |
|------------|--------|------------|
| **Node.js** | >= 18 | Фронтенд, Anchor TS клиент |
| **npm** | >= 9 | Менеджер пакетов |
| **Rust** | >= 1.70 | Компиляция Anchor контракта |
| **Anchor CLI** | 0.30.x | Сборка и деплой контракта |
| **Solana CLI** | >= 1.17 | Работа с кластером, keypair, airdrop |

### Для C++ эмулятора

| Инструмент | Версия | Назначение |
|------------|--------|------------|
| **CMake** | >= 3.16 | Система сборки |
| **g++ / clang++** | C++17 | Компилятор |
| **nlohmann/json** | >= 3.11 | JSON (скачается автоматически через FetchContent) |
| **libcurl** (опционально) | — | JSON-RPC transport (без неё — только CLI bridge) |

### Для фронтенда

| Инструмент | Версия | Назначение |
|------------|--------|------------|
| **Phantom Wallet** | — | Браузерное расширение для подписи транзакций |

---

## Установка и запуск

### 1. Solana Validator (localnet)

Для локальной разработки запустите собственный валидатор:

```bash
# Генерация keypair (если нет)
solana-keygen new --outfile ~/.config/solana/id.json

# Переключение на localnet
solana config set --url http://127.0.0.1:8899

# Запуск валидатора в отдельном терминале
solana-test-validator

# Пополнение баланса
solana airdrop 10
```

### 2. Anchor контракт

```bash
cd backend/anchor-contract

# Сборка контракта (генерирует IDL + .so)
anchor build

# Деплой на localnet
anchor deploy

# Запуск тестов
anchor test
```

После деплоя скопируйте Program ID из вывода. Если он отличается от `EMtr1111111111111111111111111111111111111111`, обновите:
- `Anchor.toml` → `[programs.localnet]`
- `lib.rs` → `declare_id!(...)`
- `.env.local` → `NEXT_PUBLIC_PROGRAM_ID`

#### Инициализация системы

После деплоя нужно создать `GlobalConfig` и хотя бы одну квартиру. Это можно сделать через тесты или вручную:

```bash
cd backend

# Установка зависимостей для TS-скриптов
npm install

# Инициализация счётчика (создание PDA квартиры)
npx ts-node scripts/init_meter.ts APT-42-7F \
    ~/.config/solana/id.json \
    EMtr1111111111111111111111111111111111111111 \
    http://127.0.0.1:8899
```

### 3. C++ эмулятор

```bash
cd backend

# Сборка через CMake
mkdir -p build && cd build
cmake ..
make

# Запуск (реальная синхронизация с блокчейном)
./smart_meter \
    --device-id APT-42-7F \
    --interval 10 \
    --rpc http://127.0.0.1:8899 \
    --keypair ~/.config/solana/id.json \
    --program-id EMtr1111111111111111111111111111111111111111

# Или сухой запуск (без блокчейн-транзакций)
./smart_meter --dry-run
```

#### Параметры CLI

| Флаг | По умолчанию | Описание |
|------|-------------|----------|
| `--device-id` | `APT-42-7F` | ID счётчика (совпадает с PDA seed) |
| `--interval` | `10` | Интервал синхронизации с блокчейном (сек) |
| `--rpc` | `http://127.0.0.1:8899` | Solana RPC endpoint |
| `--keypair` | `~/.config/solana/id.json` | Путь к Oracle keypair |
| `--program-id` | `EMtr111...` | ID деплоенного контракта |
| `--base-load` | `1500` | Базовая нагрузка в ваттах |
| `--dry-run` | `false` | Отключить реальные транзакции |

#### Альтернативная сборка (без CMake)

```bash
g++ -std=c++17 -Iinclude -o smart_meter src/main.cpp src/smart_meter.cpp
```

### 4. Next.js фронтенд

```bash
cd frontend/propchain

# Установка зависимостей
npm install

# Настройка окружения
cp .env.local.example .env.local
# Отредактируйте .env.local при необходимости

# Запуск dev-сервера
npm run dev
```

Откройте http://localhost:3000 в браузере с установленным Phantom Wallet.

#### Production сборка

```bash
npm run build
npm start
```

---

## Смарт-контракт

### Инструкции

| Инструкция | Кто вызывает | Описание |
|------------|-------------|----------|
| `initialize_config` | Admin | Создание `GlobalConfig`: тариф, oracle pubkey, USDC mint, service vault |
| `update_tariff` | Admin | Обновление тарифа без переинициализации |
| `initialize_apartment` | Admin | Создание PDA квартиры: device_id, owner, tenant |
| `record_consumption` | Oracle (C++) | Запись потребления: `accumulated_power += amount`, пересчёт долга |
| `pay_utilities` | Tenant | Оплата USDC: 95% → owner, 5% → service vault |

### Аккаунты (PDA)

#### GlobalConfig

```
Seeds: ["global_config"]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `admin` | Pubkey | Администратор |
| `oracle` | Pubkey | Oracle (C++ счётчик) |
| `tariff_usdc_per_power` | u64 | Цена за 1 POWER в USDC (6 decimals) |
| `usdc_mint` | Pubkey | Адрес USDC mint |
| `service_vault` | Pubkey | Сервисный USDC-кошелёк (5% комиссия) |
| `bump` | u8 | PDA bump |

#### Apartment

```
Seeds: ["apartment", device_id.as_bytes()]
```

| Поле | Тип | Описание |
|------|-----|----------|
| `device_id` | String | ID счётчика (= C++ `--device-id`) |
| `owner_pubkey` | Pubkey | Инвестор — получает 95% |
| `tenant_pubkey` | Pubkey | Арендатор — оплачивает КУ |
| `accumulated_power` | u64 | Суммарное потребление (единицы POWER) |
| `unpaid_balance_usdc` | u64 | Неоплаченный долг (USDC, 6 decimals) |
| `bump` | u8 | PDA bump |

### Коды ошибок

| Код | Имя | Описание |
|-----|-----|----------|
| 6000 | `Unauthorized` | Только admin может выполнить действие |
| 6001 | `UnauthorizedOracle` | Только авторизованный Oracle может записывать потребление |
| 6002 | `NotTenant` | Только арендатор может оплачивать |
| 6003 | `OverPayment` | Сумма оплаты превышает долг |
| 6004 | `ZeroConsumption` | Нулевое потребление |
| 6005 | `ZeroPayment` | Нулевая оплата |
| 6006 | `Overflow` | Арифметическое переполнение |
| 6007 | `TokenAccountMismatch` | Несоответствие владельца token account |

---

## C++ эмулятор (подробно)

### Класс SmartMeter

Эмулирует физический счётчик электроэнергии:

- **Симуляция**: каждый тик (1 сек) генерирует потребление по нормальному распределению `N(base_load, 15%)` с 5% вероятностью пиковой нагрузки (×1.8).
- **Накопление**: `E = P × t / 3_600_000` кВт·ч за тик.
- **Blockchain bridge**: два режима:
  - **CLI bridge** (production): вызывает `sync_meter.sh` → `update_meter.ts` → Anchor RPC.
  - **JSON-RPC** (demo): формирует JSON payload для `simulateTransaction` (без подписи).

### Структуры данных

```cpp
struct MeterReading {
    string   device_id;       // "APT-42-7F"
    double   kwh;             // Человекочитаемые кВт·ч
    uint64_t micro_wh;        // µWh для контракта (1 kWh = 1e9 µWh)
    int64_t  timestamp_unix;  // Unix timestamp
};

struct BlockchainConfig {
    string rpc_url;           // "http://127.0.0.1:8899"
    string program_id;        // Program ID контракта
    string keypair_path;      // Путь к Oracle keypair
    string apartment_pda;     // PDA квартиры (вычисляется автоматически)
    bool   use_cli_bridge;    // true = реальные транзакции
};
```

---

## Фронтенд (подробно)

### Технологии

- **Next.js 16** (Turbopack) + React 19
- **@solana/wallet-adapter** — подключение Phantom Wallet
- **@coral-xyz/anchor** — чтение PDA аккаунтов и отправка транзакций
- **@solana/spl-token** — работа с USDC (Associated Token Accounts)

### Компоненты

| Файл | Описание |
|------|----------|
| `WalletProvider.jsx` | Обёртка ConnectionProvider + WalletProvider + WalletModalProvider |
| `Dashboard.jsx` | Основной интерфейс: экран входа, вид арендатора, вид инвестора |
| `lib/program.js` | Anchor клиент: PDA-деривация, fetchGlobalConfig, fetchApartment, payUtilities |

### Экран арендатора

- Подключение Phantom Wallet → выбор роли "Арендатор"
- Чтение `Apartment` PDA каждые 10 секунд → актуальные показания счётчика
- Отображение долга (рассчитанного контрактом)
- Кнопка "Оплатить" → подписание транзакции `pay_utilities` в Phantom
- On-chain информация: Program ID, device ID, accumulated power, tariff

### Экран инвестора

- Чтение всех `Apartment` аккаунтов через `program.account.apartment.all()`
- Агрегированная статистика: суммарное потребление, загрузка, невыплаченный долг
- Список всех квартир с данными по каждой
- Управление арендаторами (локальное + on-chain из PDA)

### Fallback-режим

Если аккаунты не найдены (контракт не задеплоен / не инициализирован), Dashboard показывает:
- Предупреждение "Аккаунт не найден — используются демо-данные"
- Моковые графики истории потребления
- Корректно работает без блокчейна для демонстрации UI

---

## Переменные окружения

### Frontend (`frontend/propchain/.env.local`)

| Переменная | По умолчанию | Описание |
|------------|-------------|----------|
| `NEXT_PUBLIC_SOLANA_NETWORK` | `devnet` | Сеть: `devnet`, `mainnet-beta`, или любая |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | (clusterApiUrl) | Кастомный RPC URL (например, `http://127.0.0.1:8899`) |
| `NEXT_PUBLIC_PROGRAM_ID` | `EMtr111...` | Program ID деплоенного контракта |
| `NEXT_PUBLIC_DEVICE_ID` | `APT-42-7F` | Device ID по умолчанию |

---

## Типичные сценарии

### Полный запуск на localnet

```bash
# Терминал 1: Solana validator
solana-test-validator

# Терминал 2: Деплой контракта
cd backend/anchor-contract
anchor build && anchor deploy

# Терминал 3: C++ эмулятор
cd backend/build
./smart_meter --device-id APT-42-7F --interval 10

# Терминал 4: Фронтенд
cd frontend/propchain
npm run dev
```

### Демо без блокчейна

```bash
# C++ эмулятор в dry-run режиме
./smart_meter --dry-run

# Фронтенд работает с моковыми данными
cd frontend/propchain && npm run dev
```

### Подключение к devnet

```bash
# 1. Задеплоить контракт на devnet
solana config set --url https://api.devnet.solana.com
cd backend/anchor-contract
anchor build && anchor deploy

# 2. Обновить Program ID во фронтенде
# frontend/propchain/.env.local:
# NEXT_PUBLIC_SOLANA_NETWORK=devnet
# NEXT_PUBLIC_PROGRAM_ID=<новый program id>

# 3. Запустить фронтенд
cd frontend/propchain && npm run dev
```

---

## Лицензия

MIT
