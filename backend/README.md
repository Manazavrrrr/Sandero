# ⚡ Smart Meter Emulator → Solana Blockchain

A C++17 console application that emulates a physical electricity meter, generating
realistic energy consumption data and syncing it to a Solana smart-contract (Anchor/Rust).

---

## Architecture

```
┌──────────────────────────┐         ┌───────────────────────────┐
│   C++ Smart Meter        │         │   Solana Blockchain       │
│                          │         │                           │
│  ┌────────────────────┐  │  CLI /  │  ┌─────────────────────┐  │
│  │ SmartMeter class    │──┼──RPC──▶│  │ energy_meter program│  │
│  │  • generateUsage()  │  │         │  │  • initialize()     │  │
│  │  • syncBlockchain() │  │         │  │  • update_meter_    │  │
│  │  • tick simulation  │  │         │  │      data()         │  │
│  └────────────────────┘  │         │  └─────────┬───────────┘  │
│                          │         │            │              │
│  tick every 1s           │         │  ┌─────────▼───────────┐  │
│  sync every N seconds    │         │  │ Apartment (PDA)     │  │
│                          │         │  │  • device_id        │  │
│                          │         │  │  • energy_micro_wh  │  │
│                          │         │  │  • last_updated     │  │
└──────────────────────────┘         └──┴─────────────────────┴──┘
```

## Directory Structure

```
smart-meter-solana/
├── CMakeLists.txt              # C++ build
├── include/
│   └── smart_meter.hpp         # SmartMeter class header
├── src/
│   ├── main.cpp                # Entry point — tick loop
│   └── smart_meter.cpp         # Implementation
├── scripts/
│   ├── init_meter.sh           # Create on-chain account
│   ├── sync_meter.sh           # Bridge: C++ → Anchor CLI
│   └── update_meter.ts         # Anchor TS client
└── anchor-contract/
    ├── Anchor.toml
    └── programs/energy_meter/
        ├── Cargo.toml
        └── src/lib.rs          # Rust smart-contract
```

## Prerequisites

| Tool             | Purpose                     | Install                              |
|------------------|-----------------------------|--------------------------------------|
| g++ / clang++    | C++17 compiler              | `apt install g++`                    |
| CMake ≥ 3.16     | Build system                | `apt install cmake`                  |
| nlohmann/json    | JSON library (auto-fetched) | —                                    |
| libcurl (opt.)   | Raw JSON-RPC transport      | `apt install libcurl4-openssl-dev`   |
| Solana CLI       | Key management & signing    | `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"` |
| Anchor CLI       | Build & deploy contract     | `cargo install --git https://github.com/coral-xyz/anchor avm` |
| Node.js + yarn   | Anchor TS client            | `apt install nodejs`                 |

## Quick Start

### 1. Build the C++ Emulator

```bash
mkdir build && cd build
cmake ..
make -j$(nproc)
```

### 2. Run in Dry-Run Mode (no Solana needed)

```bash
./smart_meter --dry-run --interval 5
```

This ticks every second and prints simulated readings + JSON payloads without
sending real transactions.

### 3. Full Blockchain Integration

```bash
# Terminal 1: Start local validator
solana-test-validator

# Terminal 2: Build & deploy the contract
cd anchor-contract
anchor build
anchor deploy

# Terminal 3: Initialize the meter account & run
cd ..
./smart_meter --device-id APT-42-7F --interval 10 --rpc http://127.0.0.1:8899
```

## CLI Options

| Flag            | Default                      | Description                    |
|-----------------|------------------------------|--------------------------------|
| `--device-id`   | `APT-42-7F`                  | Meter identifier               |
| `--interval`    | `10`                         | Seconds between syncs          |
| `--rpc`         | `http://127.0.0.1:8899`     | Solana RPC endpoint            |
| `--keypair`     | `~/.config/solana/id.json`   | Payer/authority keypair        |
| `--program-id`  | (placeholder)                | Deployed Anchor program ID     |
| `--base-load`   | `1500`                       | Average consumption in Watts   |
| `--dry-run`     | off                          | Skip blockchain transactions   |

## How It Works

1. **Tick simulation**: Every second, `generateUsage()` samples from a normal
   distribution centered on `base_load` watts, with a 5% chance of a spike
   (simulating an appliance turning on). Energy integrates as `P × t`.

2. **Sync cycle**: Every `--interval` seconds, the emulator calls
   `syncWithBlockchain()` which either:
   - **CLI bridge** (default): shells out to `scripts/sync_meter.sh` →
     calls Anchor TS client → signs & sends a real Solana transaction.
   - **JSON-RPC** (fallback): sends an illustrative JSON payload to the
     RPC node (requires `HAS_LIBCURL` + ed25519 signing for production).

3. **On-chain state**: The Anchor program stores cumulative `energy_micro_wh`
   (µWh for precision) in a PDA account derived from `["apartment", device_id]`.

## Smart Contract (Anchor)

Two instructions:

- **`initialize(device_id: String)`** — creates the `Apartment` PDA.
- **`update_meter_data(energy_micro_wh: u64)`** — updates the reading.
  Rejects decreasing values (meter can only go up).

## License

MIT
