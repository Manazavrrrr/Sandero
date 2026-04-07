#!/usr/bin/env bash
#
# sync_meter.sh — bridge between the C++ emulator and the Anchor program.
#
# Calls `record_consumption` on-chain via the Oracle keypair.
#
# Usage:
#   bash sync_meter.sh \
#       --device-id APT-42-7F \
#       --energy    123456789 \
#       --keypair   ~/.config/solana/id.json \
#       --program-id EMtr111... \
#       --rpc       http://127.0.0.1:8899
#
set -euo pipefail

DEVICE_ID=""
ENERGY=""
KEYPAIR=""
PROGRAM_ID=""
RPC_URL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --device-id)   DEVICE_ID="$2";   shift 2 ;;
        --energy)      ENERGY="$2";      shift 2 ;;
        --keypair)     KEYPAIR="$2";     shift 2 ;;
        --program-id)  PROGRAM_ID="$2";  shift 2 ;;
        --rpc)         RPC_URL="$2";     shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

echo "┌─ sync_meter.sh ─────────────────────────────"
echo "│ device  : ${DEVICE_ID}"
echo "│ energy  : ${ENERGY} (POWER units)"
echo "│ program : ${PROGRAM_ID}"
echo "│ rpc     : ${RPC_URL}"
echo "└──────────────────────────────────────────────"

# Option A: Use Anchor TS client via npx (most robust).
if command -v npx &>/dev/null && [ -f "./anchor-contract/target/idl/energy_meter.json" ]; then
    echo "[sync] Using Anchor TS client (update_meter.ts → record_consumption)..."
    npx ts-node ./scripts/update_meter.ts \
        "${DEVICE_ID}" "${ENERGY}" "${KEYPAIR}" "${PROGRAM_ID}" "${RPC_URL}"
    exit $?
fi

# Option B: Raw instruction via TS (no IDL needed).
if command -v npx &>/dev/null; then
    echo "[sync] IDL not found. Using raw instruction (send_raw_instruction.ts)..."
    npx ts-node ./scripts/send_raw_instruction.ts \
        "${DEVICE_ID}" "${ENERGY}" "${KEYPAIR}" "${PROGRAM_ID}" "${RPC_URL}"
    exit $?
fi

echo "[ERROR] 'npx' not found. Install Node.js to use the TS bridge scripts."
exit 1
