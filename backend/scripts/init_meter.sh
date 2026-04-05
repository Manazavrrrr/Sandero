#!/usr/bin/env bash
#
# init_meter.sh — create the on-chain Apartment PDA for a device.
#
set -euo pipefail

DEVICE_ID=""
KEYPAIR=""
PROGRAM_ID=""
RPC_URL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --device-id)   DEVICE_ID="$2";   shift 2 ;;
        --keypair)     KEYPAIR="$2";     shift 2 ;;
        --program-id)  PROGRAM_ID="$2";  shift 2 ;;
        --rpc)         RPC_URL="$2";     shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

echo "┌─ init_meter.sh ─────────────────────────────"
echo "│ device  : ${DEVICE_ID}"
echo "│ program : ${PROGRAM_ID}"
echo "│ rpc     : ${RPC_URL}"
echo "└──────────────────────────────────────────────"

if command -v npx &>/dev/null && [ -f "./anchor-contract/target/idl/energy_meter.json" ]; then
    echo "[init] Using Anchor TS client..."
    npx ts-node ./scripts/init_meter.ts \
        "${DEVICE_ID}" "${KEYPAIR}" "${PROGRAM_ID}" "${RPC_URL}"
    exit $?
fi

echo "[WARN] Anchor IDL not built. Run 'cd anchor-contract && anchor build' first."
echo "[WARN] Then re-run this script."
exit 1
