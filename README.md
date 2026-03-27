<div align="center">

# 🏛️ Solana RWA Hub

### Фракционная токенизация реальных активов на скорости света — без посредников, без барьеров.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Built on Solana](https://img.shields.io/badge/Built%20on-Solana-9945FF?logo=solana)](https://solana.com)
[![Token-2022](https://img.shields.io/badge/Token%20Standard-Token--2022-14F195)](https://spl.solana.com/token-2022)
[![Anchor](https://img.shields.io/badge/Framework-Anchor-FF6B35)](https://www.anchor-lang.com/)
[![Network](https://img.shields.io/badge/Network-Devnet-blue)](https://explorer.solana.com/?cluster=devnet)

</div>

---

## 📌 Проблема

Рынок реальных активов — недвижимость, GPU-кластеры, облигации, сырьё — остаётся одним из наименее доступных и наименее ликвидных сегментов мировой экономики. Три фундаментальные проблемы блокируют широкое участие инвесторов:

| Проблема | Последствие |
|---|---|
| **Высокий порог входа** | Минимальный чек для инвестиций в недвижимость — сотни тысяч долларов. Рынок закрыт для 99% населения. |
| **Низкая ликвидность** | Продать долю в активе занимает месяцы. Вторичный рынок фрагментирован или отсутствует. |
| **Непрозрачность владения** | Цепочки посредников, реестры прав собственности, ручная верификация документов — всё это создаёт поле для мошенничества и ошибок. |

Существующие «решения» — REIT-фонды, краудфандинговые платформы — лишь перемещают проблему на уровень выше, добавляя комиссии посредников и сохраняя централизованный контроль.

---

## 💡 Решение: Solana RWA Hub

**Solana RWA Hub** — это on-chain протокол и платформа для фракционной токенизации реальных активов с полным end-to-end потоком: от загрузки юридических документов до P2P-торговли долями на вторичном рынке.

Протокол решает три ключевые проблемы:

- **Порог входа** → Любой актив дробится на тысячи токенов. Инвестиция от $1.
- **Ликвидность** → Встроенный P2P-маркетплейс обеспечивает мгновенную торговлю долями 24/7.
- **Прозрачность** → Каждый токен криптографически привязан к юридическим документам через IPFS (Proof-of-Asset). Вся история владения — on-chain.

---

## ✨ Ключевые возможности

### 🏗️ RWA Constructor — Конструктор токенизации активов

Интерфейс для эмитентов позволяет токенизировать любой реальный актив за несколько шагов:

- Поддерживаемые классы активов: **Недвижимость**, **GPU-кластеры**, **Облигации**, **Сырьё**
- Гибкая настройка: количество фракций, цена за долю, минимальный лот
- Автоматическая загрузка правоустанавливающих документов на IPFS через Pinata
- Генерация on-chain метаданных токена с CID-хешем документов (Proof-of-Asset)

### 🪙 Token-2022 — Стандарт следующего поколения для RWA

Протокол использует **Token-2022 (Token Extensions Program)**, что даёт критически важные для RWA возможности «из коробки»:

| Расширение | Применение |
|---|---|
| `MetadataPointer` + `TokenMetadata` | On-chain хранение имени актива, символа, URI на IPFS-документы |
| `PermanentDelegate` | Принудительный выкуп или заморозка токена регулятором/эмитентом (compliance) |
| `TransferHook` | Кастомная логика при каждом трансфере: KYC-проверки, whitelist инвесторов |
| `NonTransferable` | Токены-сертификаты владения, не подлежащие передаче |
| `InterestBearingMint` | Начисление процентов on-chain для долговых инструментов |

### 🏪 P2P Marketplace — Децентрализованный вторичный рынок

Эскроу-based торговля фракциями активов без централизованного маркет-мейкера:

- Создание ордеров на продажу с фиксированной ценой
- Мгновенное атомарное исполнение сделок через Anchor-эскроу
- История транзакций полностью on-chain
- Комиссия протокола: настраиваемая (по умолчанию 0.5%)

### 🔗 Decentralized Proof-of-Asset

Верифицируемая связь между физическим активом и его цифровым токеном:

- Эмитент загружает правоустанавливающие документы → Pinata пинит файлы на IPFS → CID хранится в on-chain метаданных токена
- Любой инвестор может верифицировать документ через IPFS-гейтвей независимо от платформы
- Immutable: после минтинга URI документа не может быть изменён без on-chain транзакции эмитента

---

## 🏛️ Техническая архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND LAYER                           │
│              Next.js 14 (App Router) + TypeScript               │
│         Tailwind CSS + shadcn/ui + @solana/wallet-adapter       │
└───────────────────────┬─────────────────────────────────────────┘
                        │ RPC calls
┌───────────────────────▼─────────────────────────────────────────┐
│                     WEB3 INTEGRATION                            │
│           @solana/web3.js + @coral-xyz/anchor                   │
│              Wallet: Phantom / Backpack / Solflare              │
└───────────┬───────────────────────────────┬─────────────────────┘
            │ Instructions                  │ Metadata URI
┌───────────▼───────────┐       ┌───────────▼─────────────────────┐
│    ON-CHAIN LAYER     │       │         OFF-CHAIN STORAGE        │
│                       │       │                                  │
│  Anchor Program (Rust)│       │  IPFS via Pinata                 │
│  ├─ rwa_constructor   │       │  ├─ Legal documents (PDF)        │
│  │  └─ mint_asset()  │       │  ├─ Asset metadata (JSON)        │
│  ├─ marketplace       │       │  └─ Images / certificates        │
│  │  ├─ list_asset()  │       │                                  │
│  │  └─ buy_asset()   │       └──────────────────────────────────┘
│  └─ escrow            │
│     └─ settle()       │
│                       │
│  Token-2022 Program   │
│  ├─ MetadataPointer   │
│  ├─ PermanentDelegate │
│  └─ TransferHook      │
└───────────────────────┘
         Solana Devnet
```

### On-chain: Anchor Program

**Программа состоит из трёх модулей:**

#### 1. `rwa_constructor` — Минтинг токенизированных активов

```rust
// Основные аккаунты state-машины
#[account]
pub struct AssetVault {
    pub authority: Pubkey,          // Эмитент актива
    pub mint: Pubkey,               // Mint токена (Token-2022)
    pub total_fractions: u64,       // Общее количество фракций
    pub fraction_price: u64,        // Цена фракции в lamports
    pub ipfs_cid: String,           // CID документов на IPFS (Proof-of-Asset)
    pub asset_type: AssetType,      // Real Estate | GPU | Bond | Commodity
    pub is_active: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum AssetType {
    RealEstate,
    GpuCluster,
    Bond,
    Commodity,
}
```

**Инструкция `initialize_asset`:**
- Создаёт Mint через Token-2022 Program с расширениями `MetadataPointer` и `PermanentDelegate`
- Инициализирует on-chain метаданные (название, символ, URI на IPFS)
- Сохраняет `AssetVault` PDA с параметрами актива и IPFS CID

**Инструкция `mint_fractions`:**
- Минтит заданное количество fraction-токенов на Associated Token Account эмитента
- Устанавливает `freeze_authority` для compliance

#### 2. `marketplace` — P2P торговля фракциями

```rust
#[account]
pub struct ListingAccount {
    pub seller: Pubkey,
    pub asset_vault: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,               // Количество фракций в листинге
    pub price_per_fraction: u64,   // Цена за фракцию в lamports
    pub escrow_token_account: Pubkey,
    pub is_active: bool,
    pub bump: u8,
}
```

**Инструкция `list_asset`:**
- Создаёт `ListingAccount` PDA
- Переводит токены продавца в эскроу-аккаунт программы (PDA-controlled)

**Инструкция `buy_asset`:**
- Атомарно: переводит SOL от покупателя продавцу + токены из эскроу покупателю
- Удаляет `ListingAccount` (rent reclaim)

#### 3. `escrow` — Атомарные расчёты

Эскроу-аккаунт контролируется PDA программы. Ни продавец, ни покупатель не могут вывести активы в обход инструкции `settle()`. Это обеспечивает trustless-торговлю без централизованного custody.

### Off-chain: Next.js Architecture

```
app/
├── (auth)/
│   └── connect/          # Wallet connection flow
├── dashboard/
│   ├── portfolio/        # Портфель инвестора (фракции)
│   └── assets/           # Управление активами эмитента
├── marketplace/
│   ├── page.tsx          # Листинг активов
│   └── [assetId]/        # Детальная страница актива
├── tokenize/
│   └── page.tsx          # RWA Constructor (форма минтинга)
└── api/
    └── ipfs/
        └── upload/       # Server Action: загрузка на Pinata

lib/
├── anchor/
│   ├── idl.ts            # Сгенерированный IDL Anchor-программы
│   └── program.ts        # Хелпер инициализации Provider + Program
├── solana/
│   ├── token2022.ts      # Хелперы создания Mint с расширениями
│   └── transactions.ts   # Построение и отправка транзакций
└── ipfs/
    └── pinata.ts         # Клиент Pinata SDK
```

---

## 🔄 Пользовательский сценарий

### Эмитент (Tokenization Flow)

```
1. Подключить кошелёк (Phantom / Backpack)
   │
2. Открыть RWA Constructor
   │
3. Заполнить форму актива:
   │   • Название и описание
   │   • Тип актива (Real Estate / GPU / Bond)
   │   • Количество фракций и цена за фракцию
   │   • Загрузить правоустанавливающие документы (PDF, JPG)
   │
4. Документы → Pinata → IPFS → получить CID
   │
5. Подписать транзакцию:
   │   initialize_asset() → Token-2022 Mint создан
   │   mint_fractions()  → Токены на счёт эмитента
   │
6. Создать листинг на маркетплейсе:
   │   list_asset() → фракции в эскроу
   │
✅ Актив токенизирован и доступен инвесторам
```

### Инвестор (Investment Flow)

```
1. Подключить кошелёк
   │
2. Открыть маркетплейс → browse активов
   │
3. Выбрать актив → просмотреть on-chain метаданные
   │   • Верифицировать документы через IPFS-ссылку (Proof-of-Asset)
   │   • Проверить историю транзакций on-chain
   │
4. Выбрать количество фракций → нажать "Buy"
   │
5. Подписать транзакцию:
   │   buy_asset() → атомарный своп SOL ↔ токены фракций
   │
6. Открыть Dashboard → Portfolio:
   │   • Просмотр всех фракций
   │   • Sell fractions обратно на маркетплейс
   │
✅ Инвестор стал совладельцем реального актива
```

---

## ⚡ Почему Solana и Token-2022?

### Технические преимущества Solana

| Метрика | Solana | Ethereum | Polygon |
|---|---|---|---|
| TPS | ~65,000 | ~15–30 | ~7,000 |
| Время финализации | ~400ms | ~12–15 сек | ~2–3 сек |
| Комиссия за транзакцию | ~$0.00025 | $1–50+ | $0.01–0.1 |
| Стоимость хранения аккаунта | ~0.002 SOL | — | — |

Для маркетплейса с тысячами P2P-транзакций в день комиссии Ethereum делают бизнес-модель нежизнеспособной. Solana устраняет этот барьер полностью.

### Почему Token-2022, а не SPL Token?

Классический SPL Token — примитивный стандарт без встроенной поддержки compliance-требований, критически важных для RWA. Token-2022 решает это нативно:

- **MetadataPointer** позволяет хранить on-chain метаданные без внешних программ (Metaplex не нужен для базовых RWA)
- **PermanentDelegate** — эмитент может принудительно перевести токен в случае судебного решения или регуляторного требования (аналог "freeze" в TradFi)
- **TransferHook** — перед каждым трансфером вызывается кастомная программа: проверка KYC статуса покупателя, whitelist юрисдикций, лимиты на объём
- **InterestBearingMint** — on-chain начисление процентов для токенизированных долговых инструментов без внешних оракулов

Эти расширения делают Token-2022 первым стандартом токенов, **нативно приспособленным** к требованиям финансовой регуляции.

---

## 🚀 Установка и локальная разработка

### Предварительные требования

- [Rust](https://www.rust-lang.org/tools/install) >= 1.75
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) >= 1.18
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) >= 0.30
- [Node.js](https://nodejs.org/) >= 20.x
- [Pinata](https://pinata.cloud/) API Key (для IPFS)

### 1. Клонирование репозитория

```bash
git clone https://github.com/your-username/solana-rwa-hub.git
cd solana-rwa-hub
```

### 2. Настройка Solana CLI

```bash
# Переключиться на Devnet
solana config set --url devnet

# Создать/импортировать кошелёк разработчика
solana-keygen new --outfile ~/.config/solana/devnet.json
solana config set --keypair ~/.config/solana/devnet.json

# Получить тестовые SOL
solana airdrop 4
solana balance
```

### 3. Сборка и деплой Anchor-программы

```bash
cd anchor

# Установить зависимости Rust/Anchor
anchor build

# Получить Program ID после сборки
solana address -k target/deploy/solana_rwa_hub-keypair.json

# Обновить Program ID в lib.rs и Anchor.toml
# declare_id!("ВАШ_PROGRAM_ID");

# Повторная сборка с актуальным ID
anchor build

# Деплой на Devnet
anchor deploy --provider.cluster devnet

# Запуск тестов
anchor test --skip-local-validator
```

### 4. Настройка Frontend

```bash
cd ../frontend

# Установить зависимости
npm install

# Создать файл переменных окружения
cp .env.example .env.local
```

Заполнить `.env.local`:

```env
# Solana
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_RPC_ENDPOINT=https://api.devnet.solana.com
NEXT_PUBLIC_PROGRAM_ID=ВАШ_PROGRAM_ID

# Pinata IPFS
PINATA_API_KEY=ваш_api_key
PINATA_SECRET_API_KEY=ваш_secret_key
NEXT_PUBLIC_IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
```

```bash
# Запустить в режиме разработки
npm run dev
```

Открыть в браузере: [http://localhost:3000](http://localhost:3000)

### 5. Структура проекта

```
solana-rwa-hub/
├── anchor/                    # Rust / Anchor смарт-контракт
│   ├── programs/
│   │   └── solana_rwa_hub/
│   │       └── src/
│   │           ├── lib.rs            # Точка входа программы
│   │           ├── instructions/
│   │           │   ├── initialize_asset.rs
│   │           │   ├── mint_fractions.rs
│   │           │   ├── list_asset.rs
│   │           │   └── buy_asset.rs
│   │           ├── state/
│   │           │   ├── asset_vault.rs
│   │           │   └── listing.rs
│   │           └── errors.rs
│   ├── tests/
│   │   └── solana_rwa_hub.ts  # Интеграционные тесты
│   └── Anchor.toml
│
└── frontend/                  # Next.js App
    ├── app/
    ├── components/
    ├── lib/
    └── package.json
```

---

## 🗺️ Дорожная карта

### v1.0 — MVP (текущий релиз, Devnet)
- [x] RWA Constructor: минтинг фракций с Token-2022
- [x] Proof-of-Asset: привязка on-chain токена к IPFS-документам
- [x] P2P Marketplace: эскроу-торговля фракциями
- [x] Dashboard: портфель инвестора и управление активами

### v1.1 — Yield & Income Distribution *(Q3 2026)*
- [ ] On-chain распределение дохода (аренда, дивиденды) между держателями фракций
- [ ] Автоматический пропорциональный сплит через Token-2022 `InterestBearingMint`
- [ ] История выплат and yield-аналитика в Dashboard

### v1.2 — DAO Asset Governance *(Q4 2026)*
- [ ] DAO-голосование для совладельцев: одобрение сделок по активу, выбор управляющей компании
- [ ] On-chain предложения (Proposals) с весом голоса = количество фракций
- [ ] Интеграция с SPL Governance

### v2.0 — Compliance & Mainnet *(Q1 2027)*
- [ ] TransferHook с on-chain KYC/AML проверками (интеграция с верифицированными провайдерами)
- [ ] Whitelist-режим для институциональных инвесторов
- [ ] Оракул для привязки цены фракции к оценке реального актива (Pyth Network)
- [ ] Деплой на Solana Mainnet-Beta

---

## 📄 Лицензия

MIT License — см. файл [LICENSE](./LICENSE)

---

## 👥 Команда

Разработано для **National Solana Hackathon by Decentrathon** — Case 1: RWA Tokenization.

---

<div align="center">

**Solana RWA Hub** — открывая реальные активы для каждого.

[![Built with ❤️ on Solana](https://img.shields.io/badge/Built%20with%20%E2%9D%A4%EF%B8%8F%20on-Solana-9945FF)](https://solana.com)

</div>
