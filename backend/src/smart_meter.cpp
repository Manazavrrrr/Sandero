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
    // Fallback: unsigned JSON-RPC demo (will be rejected by validators in
    // production but useful for local testing / log inspection).
    return sendJsonRpc(buildJsonRpcPayload());
}

// ═══════════════════════════════════════════════════════════════════════════
// Blockchain — CLI bridge (MVP approach)
// ═══════════════════════════════════════════════════════════════════════════
//
// For a production MVP the simplest path that actually *signs* transactions
// is shelling out to `solana program invoke` or a thin Anchor TS client.
// Below we invoke an Anchor-compatible CLI wrapper script.
//
// The call structure mirrors:
//   anchor run update -- --device-id <id> --energy <micro_wh>
//
// For convenience we provide two modes:
//   1) A `solana` CLI command that sends a raw instruction.
//   2) A helper script `sync_meter.sh` (shipped alongside).

std::string SmartMeter::shellEscape(const std::string& arg)
{
    // Wrap in single quotes; escape embedded single quotes: ' → '\''
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
    // Uses a helper script that wraps `anchor` or `solana` CLI.
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
// Blockchain — raw JSON-RPC (demo / logging only)
// ═══════════════════════════════════════════════════════════════════════════

std::string SmartMeter::buildJsonRpcPayload() const
{
    // Build a `sendTransaction`-style JSON body.
    // NOTE: Without ed25519 signing in C++ this is illustrative.
    //       The payload shows exactly what the RPC node expects.

    const uint64_t micro_wh = currentMicroWh();

    // Anchor discriminator for `update_meter_data` = sha256("global:update_meter_data")[0..8]
    // Pre-computed: [0x5f, 0xc4, 0xb2, 0x1a, 0x03, 0xe2, 0xd1, 0x7b]  (example)
    //
    // Instruction data layout (little-endian):
    //   [8 bytes discriminator] [8 bytes u64 energy_micro_wh]

    json rpc_body = {
        {"jsonrpc", "2.0"},
        {"id",      1},
        {"method",  "simulateTransaction"},
        {"params",  json::array({
            // In a real implementation, this would be a base64-encoded
            // signed transaction.  For the demo we send a human-readable
            // placeholder so the RPC at least logs the attempt.
            json::object({
                {"_note",          "unsigned demo payload — use CLI bridge for real txns"},
                {"program_id",     config_.program_id},
                {"instruction",    "update_meter_data"},
                {"accounts", json::array({
                    {{"pubkey", config_.apartment_pda}, {"isSigner", false}, {"isWritable", true}},
                    {{"pubkey", "AUTHORITY_PUBKEY"},    {"isSigner", true},  {"isWritable", false}},
                })},
                {"data", {
                    {"energy_micro_wh", micro_wh},
                }},
            }),
            json::object({
                {"encoding", "base64"},
            }),
        })},
    };

    return rpc_body.dump(2);
}

bool SmartMeter::sendJsonRpc(const std::string& payload) const
{
    // ── libcurl path (compile with -lcurl) ──────────────────────────────
    //
    // If libcurl is available, we use it.  Otherwise fall back to
    // printing the payload (useful for dry-run / unit tests).

#ifdef HAS_LIBCURL
    #include <curl/curl.h>

    CURL* curl = curl_easy_init();
    if (!curl) return false;

    struct curl_slist* headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL,            config_.rpc_url.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER,      headers);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS,      payload.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE,
                     static_cast<curl_off_t>(payload.size()));

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        std::cerr << "[CURL] " << curl_easy_strerror(res) << "\n";
        return false;
    }
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
