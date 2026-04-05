#!/usr/bin/env bash
#
# sync_meter.sh — bridge between the C++ emulator and the Anchor program.
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

# Derive the PDA for this device.
# In production, use `anchor` or a helper to derive deterministically.
# For the MVP we assume the PDA was already created via init_meter.sh.

echo "┌─ sync_meter.sh ─────────────────────────────"
echo "│ device  : ${DEVICE_ID}"
echo "│ energy  : ${ENERGY} µWh"
echo "│ program : ${PROGRAM_ID}"
echo "│ rpc     : ${RPC_URL}"
echo "└──────────────────────────────────────────────"

# Option A: Use Anchor TS client via npx (most robust).
# Requires: `anchor-contract/` with built IDL.
if command -v npx &>/dev/null && [ -f "./anchor-contract/target/idl/energy_meter.json" ]; then
    echo "[sync] Using Anchor TS client..."
    npx ts-node ./scripts/update_meter.ts \
        "${DEVICE_ID}" "${ENERGY}" "${KEYPAIR}" "${PROGRAM_ID}" "${RPC_URL}"
    exit $?
fi

# Option B: Use `solana` CLI to send a raw instruction.
if command -v solana &>/dev/null; then
    echo "[sync] Using solana CLI..."

    # Compute Anchor instruction discriminator + data.
    # Discriminator for "update_meter_data":
    #   sha256("global:update_meter_data")[0..8] → hex
    # We pipe the u64 energy as little-endian bytes after it.
    DISC_HEX="5fc4b21a03e2d17b"

    # Convert energy (u64) to 8 little-endian hex bytes.
    ENERGY_HEX=$(printf '%016x' "${ENERGY}" | \
        sed 's/\(..\)/\1\n/g' | tac | tr -d '\n')

    INSTRUCTION_DATA="${DISC_HEX}${ENERGY_HEX}"

    # NOTE: `solana program invoke` is not a real subcommand.
    # The actual invocation requires building a full transaction.
    # This placeholder shows the data that *would* be sent.
    echo "[sync] Instruction data (hex): ${INSTRUCTION_DATA}"
    echo "[sync] TODO: Wrap in a Transaction, sign, and send via RPC."
    echo "[sync] For now, use the Anchor TS client (Option A) for full e2e."
    exit 0
fi

echo "[ERROR] Neither 'npx' (with Anchor IDL) nor 'solana' CLI found."
echo "        Install Solana CLI tools or build the Anchor project first."
exit 1
