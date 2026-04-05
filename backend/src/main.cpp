///
/// Smart Meter Emulator — main loop
///
/// Simulates a physical electricity meter that ticks every second and
/// syncs its cumulative reading to a Solana smart-contract every N seconds.
///
/// Build:
///   g++ -std=c++17 -Iinclude -o smart_meter src/main.cpp src/smart_meter.cpp
///
/// Run:
///   ./smart_meter [--device-id APT-42] [--interval 10] [--rpc http://127.0.0.1:8899]
///

#include "smart_meter.hpp"
#include <nlohmann/json.hpp>

#include <atomic>
#include <csignal>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <thread>

// ── Graceful shutdown ───────────────────────────────────────────────────────

static std::atomic<bool> g_running{true};

extern "C" void handle_signal(int) { g_running.store(false); }

// ── Helpers ─────────────────────────────────────────────────────────────────

struct CliArgs {
    std::string device_id    = "APT-42-7F";
    int         interval_sec = 10;
    std::string rpc_url      = "http://127.0.0.1:8899";
    std::string keypair_path = "~/.config/solana/id.json";
    std::string program_id   = "EMtr1111111111111111111111111111111111111111";
    double      base_load_w  = 1500.0;
    bool        dry_run      = false;
};

static CliArgs parse_args(int argc, char* argv[])
{
    CliArgs args;
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto next = [&]() -> std::string {
            if (i + 1 < argc) return argv[++i];
            throw std::runtime_error("Missing value for " + a);
        };

        if (a == "--device-id")   { args.device_id    = next(); }
        else if (a == "--interval")    { args.interval_sec = std::stoi(next()); }
        else if (a == "--rpc")         { args.rpc_url      = next(); }
        else if (a == "--keypair")     { args.keypair_path = next(); }
        else if (a == "--program-id")  { args.program_id   = next(); }
        else if (a == "--base-load")   { args.base_load_w  = std::stod(next()); }
        else if (a == "--dry-run")     { args.dry_run      = true; }
        else if (a == "--help" || a == "-h") {
            std::cout <<
R"(Smart Meter Emulator — Solana blockchain logger

Usage: smart_meter [OPTIONS]

Options:
  --device-id  <ID>     Meter identifier          [APT-42-7F]
  --interval   <SEC>    Blockchain sync interval   [10]
  --rpc        <URL>    Solana RPC endpoint        [http://127.0.0.1:8899]
  --keypair    <PATH>   Solana keypair file         [~/.config/solana/id.json]
  --program-id <B58>    Anchor program ID
  --base-load  <WATTS>  Average consumption        [1500]
  --dry-run             Disable actual blockchain calls
  -h, --help            Show this help
)";
            std::exit(0);
        }
        else {
            std::cerr << "Unknown option: " << a << "\n";
            std::exit(1);
        }
    }
    return args;
}

// ── Pretty-print a single tick ──────────────────────────────────────────────

static void print_tick(const MeterReading& r, int tick_num, int until_sync)
{
    std::cout << "\r\033[K"     // clear line
              << "⚡ [" << r.device_id << "]"
              << "  tick #" << std::setw(6) << tick_num
              << "  |  " << std::fixed << std::setprecision(6)
              << r.kwh << " kWh"
              << "  (" << r.micro_wh << " µWh)"
              << "  |  sync in " << until_sync << "s"
              << std::flush;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

int main(int argc, char* argv[])
{
    std::signal(SIGINT,  handle_signal);
    std::signal(SIGTERM, handle_signal);

    const auto args = parse_args(argc, argv);

    // ── Banner ──────────────────────────────────────────────────────────
    std::cout << R"(
 ╔══════════════════════════════════════════════════════╗
 ║   ⚡  SMART METER EMULATOR  ·  Solana Edition  ⚡   ║
 ╠══════════════════════════════════════════════════════╣
 ║  Device   : )" << std::left << std::setw(39) << args.device_id << R"(║
 ║  Interval : )" << std::setw(35) << (std::to_string(args.interval_sec) + " sec") << R"(    ║
 ║  RPC      : )" << std::setw(39) << args.rpc_url << R"(║
 ║  Dry-run  : )" << std::setw(39) << (args.dry_run ? "YES" : "NO") << R"(║
 ╚══════════════════════════════════════════════════════╝
    Press Ctrl+C to stop.
)" << std::endl;

    // ── Configure blockchain backend ────────────────────────────────────
    BlockchainConfig bc;
    bc.rpc_url        = args.rpc_url;
    bc.program_id     = args.program_id;
    bc.keypair_path   = args.keypair_path;
    bc.use_cli_bridge = !args.dry_run;

    SmartMeter meter(args.device_id, bc, args.base_load_w);

    // ── Main loop ───────────────────────────────────────────────────────
    int tick_counter  = 0;
    int sync_countdown = args.interval_sec;

    while (g_running.load()) {
        // 1. Simulate 1 second of electricity consumption.
        meter.generateUsage();
        ++tick_counter;
        --sync_countdown;

        // 2. Display live reading.
        const auto reading = meter.snapshot();
        print_tick(reading, tick_counter, std::max(sync_countdown, 0));

        // 3. Sync with blockchain every N seconds.
        if (sync_countdown <= 0) {
            sync_countdown = args.interval_sec;

            std::cout << "\n\n────────── BLOCKCHAIN SYNC #"
                      << (tick_counter / args.interval_sec)
                      << " ──────────\n";

            // Build a JSON log of the reading.
            nlohmann::json log_entry = {
                {"device_id",      reading.device_id},
                {"kwh",            reading.kwh},
                {"micro_wh",       reading.micro_wh},
                {"timestamp_unix", reading.timestamp_unix},
            };
            std::cout << "  payload: " << log_entry.dump(2) << "\n";

            if (args.dry_run) {
                std::cout << "  [DRY-RUN] Skipping actual transaction.\n";
            } else {
                const bool ok = meter.syncWithBlockchain();
                std::cout << "  result: "
                          << (ok ? "✅ SUCCESS" : "❌ FAILED") << "\n";
            }
            std::cout << "──────────────────────────────────────\n\n";
        }

        // 4. Sleep ~1 second (wall-clock tick).
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    // ── Shutdown ────────────────────────────────────────────────────────
    std::cout << "\n\n⏻ Shutting down. Final reading: "
              << std::fixed << std::setprecision(6)
              << meter.currentKwh() << " kWh\n";

    return 0;
}
