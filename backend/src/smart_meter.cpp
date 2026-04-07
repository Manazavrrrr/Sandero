#include "smart_meter.hpp"

#include <nlohmann/json.hpp>

#include <array>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>

#ifdef HAS_LIBCURL
#include <curl/curl.h>
#endif

using json = nlohmann::json;
using Clock = std::chrono::system_clock;

// ═══════════════════════════════════════════════════════════════════════════
// Construction
// ═══════════════════════════════════════════════════════════════════════════

SmartMeter::SmartMeter(std::string device_id,
                       BlockchainConfig config,
                       double base_load_w)
    : device_id_(std::move(device_id))
    , config_(std::move(config))
    , rng_(static_cast<unsigned>(
          Clock::now().time_since_epoch().count()))
    , load_dist_(base_load_w, base_load_w * 0.15)   // σ = 15 % of base
    , spike_dist_(0.0, 1.0)
{
    if (config_.apartment_pda.empty()) {
        config_.apartment_pda = derivePda();
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Simulation
// ═══════════════════════════════════════════════════════════════════════════

void SmartMeter::tick(double delta_seconds)
{
    // Instantaneous power (Watts), clamped to ≥ 0.
    double watts = std::max(0.0, load_dist_(rng_));

    // 5 % chance of a load spike (oven / AC kicking in).
    if (spike_dist_(rng_) < 0.05) {
        watts += load_dist_(rng_) * 1.8;
    }

    // E = P × t  →  kWh = W × s / 3 600 000
    const double delta_kwh = watts * delta_seconds / 3'600'000.0;

    std::lock_guard lock(mu_);
    current_kwh_ += delta_kwh;
}

void SmartMeter::generateUsage()
{
    // Simulate one "tick" of 1 second of real-world consumption.
    tick(1.0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Accessors
// ═══════════════════════════════════════════════════════════════════════════

double SmartMeter::currentKwh() const
{
    std::lock_guard lock(mu_);
    return current_kwh_;
}

uint64_t SmartMeter::currentMicroWh() const
{
    std::lock_guard lock(mu_);
    // 1 kWh = 1e9 µWh
    return static_cast<uint64_t>(current_kwh_ * 1'000'000'000.0);
}

std::string SmartMeter::deviceId() const { return device_id_; }

MeterReading SmartMeter::snapshot() const
{
    std::lock_guard lock(mu_);
    MeterReading r;
    r.device_id      = device_id_;
    r.kwh            = current_kwh_;
    r.micro_wh       = static_cast<uint64_t>(current_kwh_ * 1e9);
    r.timestamp_unix = nowUnix();
    return r;
}

// ═══════════════════════════════════════════════════════════════════════════
// Blockchain — public
// ═══════════════════════════════════════════════════════════════════════════

bool SmartMeter::initializeOnChain()
{
    if (config_.use_cli_bridge) {
        return execCli(buildInitCliCommand());
    }
    std::cerr << "[WARN] initializeOnChain() requires CLI bridge.\n";
    return false;
}

bool SmartMeter::syncWithBlockchain()
{
    ++sync_count_;

    if (config_.use_cli_bridge) {
        return execCli(buildUpdateCliCommand());
    }
    // Fallback: JSON-RPC via libcurl (sends the raw instruction payload).
    return sendJsonRpc(buildJsonRpcPayload());
}

// ═══════════════════════════════════════════════════════════════════════════
// Blockchain — CLI bridge (MVP approach)
// ═══════════════════════════════════════════════════════════════════════════
//
// The C++ emulator shells out to a TS helper that signs and sends the tx.
// This is the most practical approach without pulling in ed25519/libsodium.
//
// Flow:
//   C++ → bash sync_meter.sh → ts-node update_meter.ts → Solana RPC
//
// The Oracle keypair file is passed through; the TS script signs the tx.
// The contract verifies: signer == global_config.oracle (UnauthorizedOracle).

std::string SmartMeter::shellEscape(const std::string& arg)
{
    std::string escaped = "'";
    for (char c : arg) {
        if (c == '\'') {
            escaped += "'\\''";
        } else {
            escaped += c;
        }
    }
    escaped += "'";
    return escaped;
}

std::string SmartMeter::buildInitCliCommand() const
{
    std::ostringstream cmd;
    cmd << "bash ./scripts/init_meter.sh"
        << " --device-id "   << shellEscape(device_id_)
        << " --keypair "     << shellEscape(config_.keypair_path)
        << " --program-id "  << shellEscape(config_.program_id)
        << " --rpc "         << shellEscape(config_.rpc_url)
        << " 2>&1";
    return cmd.str();
}

std::string SmartMeter::buildUpdateCliCommand() const
{
    std::ostringstream cmd;
    cmd << "bash ./scripts/sync_meter.sh"
        << " --device-id "   << shellEscape(device_id_)
        << " --energy "      << currentMicroWh()
        << " --keypair "     << shellEscape(config_.keypair_path)
        << " --program-id "  << shellEscape(config_.program_id)
        << " --rpc "         << shellEscape(config_.rpc_url)
        << " 2>&1";
    return cmd.str();
}

bool SmartMeter::execCli(const std::string& cmd) const
{
    std::cout << "[CLI] " << cmd << "\n";

    std::array<char, 256> buf{};
    std::string output;

    std::unique_ptr<FILE, decltype(&pclose)> pipe(
        popen(cmd.c_str(), "r"), pclose);

    if (!pipe) {
        std::cerr << "[ERROR] popen() failed.\n";
        return false;
    }

    while (fgets(buf.data(), static_cast<int>(buf.size()), pipe.get())) {
        output += buf.data();
    }

    const int rc = pclose(pipe.release());
    if (rc != 0) {
        std::cerr << "[ERROR] CLI returned " << rc << ":\n" << output << "\n";
        return false;
    }

    std::cout << "[OK] " << output << "\n";
    return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// Blockchain — raw JSON-RPC via libcurl
// ═══════════════════════════════════════════════════════════════════════════
//
// Anchor instruction layout for `record_consumption(amount: u64)`:
//
//   ┌──────────────────────┬──────────────────┐
//   │ 8 bytes discriminator│ 8 bytes u64 LE   │
//   │ SHA256("global:      │ amount           │
//   │  record_consumption")│                  │
//   │  [0..8]              │                  │
//   └──────────────────────┴──────────────────┘
//
// Pre-computed discriminator (SHA-256 of "global:record_consumption"):
//   First 8 bytes in hex: compute at build time with:
//     echo -n "global:record_consumption" | sha256sum | head -c 16
//
// Accounts (in order):
//   0. apartment PDA   — writable, not signer
//   1. global_config   — readonly, not signer
//   2. oracle          — readonly, signer
//
// NOTE: Without ed25519 signing in C++ (would need libsodium), this path
// builds the *unsigned* instruction data for inspection / simulation.
// For real signed transactions, the CLI bridge path is used.

std::string SmartMeter::buildJsonRpcPayload() const
{
    const uint64_t micro_wh = currentMicroWh();

    // Instruction data: discriminator + u64 LE
    // The discriminator is the first 8 bytes of SHA-256("global:record_consumption")
    // Pre-computed hex (replace after `anchor build` confirms):
    //   echo -n "global:record_consumption" | sha256sum
    //
    // For demonstration, we encode the amount as a little-endian hex string.
    // A production C++ build would use libsodium for ed25519 signing.

    // Encode u64 as little-endian hex
    std::ostringstream energy_hex;
    for (int i = 0; i < 8; ++i) {
        energy_hex << std::hex << std::setfill('0') << std::setw(2)
                   << ((micro_wh >> (i * 8)) & 0xFF);
    }

    json rpc_body = {
        {"jsonrpc", "2.0"},
        {"id",      1},
        {"method",  "simulateTransaction"},
        {"params",  json::array({
            json::object({
                {"_note",          "unsigned demo — use CLI bridge for signed txns"},
                {"program_id",     config_.program_id},
                {"instruction",    "record_consumption"},
                {"discriminator",  "SHA256('global:record_consumption')[0..8]"},
                {"accounts", json::array({
                    {{"pubkey", config_.apartment_pda}, {"isSigner", false}, {"isWritable", true}},
                    {{"pubkey", "GLOBAL_CONFIG_PDA"},   {"isSigner", false}, {"isWritable", false}},
                    {{"pubkey", "ORACLE_PUBKEY"},        {"isSigner", true},  {"isWritable", false}},
                })},
                {"data", {
                    {"amount_micro_wh", micro_wh},
                    {"amount_hex_le",   energy_hex.str()},
                }},
            }),
            json::object({
                {"encoding", "base64"},
            }),
        })},
    };

    return rpc_body.dump(2);
}

// libcurl callback for capturing response
#ifdef HAS_LIBCURL
static size_t curl_write_callback(char* ptr, size_t size, size_t nmemb, void* userdata)
{
    auto* response = static_cast<std::string*>(userdata);
    response->append(ptr, size * nmemb);
    return size * nmemb;
}
#endif

bool SmartMeter::sendJsonRpc(const std::string& payload) const
{
#ifdef HAS_LIBCURL
    CURL* curl = curl_easy_init();
    if (!curl) return false;

    std::string response;

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL,            config_.rpc_url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER,      headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS,      payload.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE,
                     static_cast<curl_off_t>(payload.size()));
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION,   curl_write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA,       &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT,         10L);

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        std::cerr << "[CURL] " << curl_easy_strerror(res) << "\n";
        return false;
    }

    std::cout << "[JSON-RPC response] " << response << "\n";
    return true;

#else
    // Dry-run: dump the payload to stdout.
    std::cout << "[JSON-RPC payload → " << config_.rpc_url << "]\n"
              << payload << "\n";
    return true;
#endif
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

std::string SmartMeter::derivePda() const
{
    // In production you'd compute:
    //   PDA = findProgramAddress(["apartment", device_id], program_id)
    // Without libsodium/ed25519 here we return a placeholder.
    return "PDA_FOR_" + device_id_;
}

int64_t SmartMeter::nowUnix()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               Clock::now().time_since_epoch())
        .count();
}
