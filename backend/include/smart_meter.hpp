#pragma once

#include <string>
#include <cstdint>
#include <random>
#include <chrono>
#include <functional>
#include <mutex>
#include <atomic>

/// Represents a single meter reading snapshot.
struct MeterReading {
    std::string   device_id;
    double        kwh;               // human-readable kWh
    uint64_t      micro_wh;          // µWh sent to the contract
    int64_t       timestamp_unix;    // seconds since epoch
};

/// Configuration for the blockchain backend.
struct BlockchainConfig {
    std::string rpc_url        = "http://127.0.0.1:8899";   // local validator
    std::string program_id     = "EMtr1111111111111111111111111111111111111111";
    std::string keypair_path   = "~/.config/solana/id.json"; // payer / authority
    std::string apartment_pda;                                // computed at init
    bool        use_cli_bridge = true;   // true  → `solana` CLI for signing
                                         // false → raw JSON-RPC (unsigned demo)
};

/// Emulates a physical smart-meter device and syncs with Solana.
class SmartMeter {
public:
    /// @param device_id   Unique identifier burned into the meter (e.g. "APT-42-7F").
    /// @param config      Solana connectivity settings.
    /// @param base_load_w Average base load in watts (randomness applied around this).
    explicit SmartMeter(std::string device_id,
                        BlockchainConfig config,
                        double base_load_w = 1500.0);

    ~SmartMeter() = default;

    // ── Simulation ──────────────────────────────────────────────────────

    /// Advance the simulated clock by `delta_seconds` and accumulate energy.
    /// Thread-safe.
    void              tick(double delta_seconds);

    /// Convenience: generate a random consumption burst and tick.
    void              generateUsage();

    // ── Blockchain ──────────────────────────────────────────────────────

    /// Push the current cumulative reading to the Solana smart-contract.
    /// Returns true on success.
    bool              syncWithBlockchain();

    /// One-shot: create the on-chain Apartment PDA (calls `initialize`).
    bool              initializeOnChain();

    // ── Accessors ───────────────────────────────────────────────────────

    [[nodiscard]] double        currentKwh()     const;
    [[nodiscard]] uint64_t      currentMicroWh() const;
    [[nodiscard]] std::string   deviceId()       const;
    [[nodiscard]] MeterReading  snapshot()       const;

private:
    // ── Internal helpers ────────────────────────────────────────────────
    std::string  buildUpdateCliCommand() const;
    std::string  buildInitCliCommand()   const;
    std::string  buildJsonRpcPayload()   const;
    bool         execCli(const std::string& cmd) const;
    bool         sendJsonRpc(const std::string& payload) const;
    std::string  derivePda() const;
    static int64_t nowUnix();
    static std::string shellEscape(const std::string& arg);

    // ── State ───────────────────────────────────────────────────────────
    std::string        device_id_;
    BlockchainConfig   config_;

    mutable std::mutex mu_;
    double             current_kwh_   = 0.0;   // cumulative kWh
    uint64_t           sync_count_    = 0;

    // RNG
    std::mt19937                          rng_;
    std::normal_distribution<double>      load_dist_;   // Watts ~ N(base, σ)
    std::uniform_real_distribution<double> spike_dist_;  // occasional spikes
};
