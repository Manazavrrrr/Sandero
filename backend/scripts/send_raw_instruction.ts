/**
 * send_raw_instruction.ts — sends `update_meter_data` without requiring the
 * Anchor IDL. Used as Option B in sync_meter.sh when the IDL is not built yet.
 *
 * Constructs the transaction manually:
 *   - Anchor discriminator = SHA-256("global:update_meter_data")[0..8]
 *   - Instruction data     = [discriminator (8 bytes)] + [energy u64 LE (8 bytes)]
 *
 * Usage (called by sync_meter.sh):
 *   npx ts-node scripts/send_raw_instruction.ts \
 *       <device_id> <energy_micro_wh> <keypair_path> <program_id> <rpc_url>
 */

import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const [, , deviceId, energyStr, keypairPath, programIdStr, rpcUrl] =
        process.argv;

    if (!deviceId || !energyStr || !keypairPath || !programIdStr || !rpcUrl) {
        console.error(
            "Usage: send_raw_instruction.ts <device_id> <energy> <keypair_path> <program_id> <rpc_url>"
        );
        process.exit(1);
    }

    const energy = BigInt(energyStr);
    const programId = new PublicKey(programIdStr);

    // Load keypair.
    let raw: number[];
    try {
        raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8")) as number[];
    } catch (err) {
        console.error(`[ERROR] Cannot read keypair at ${keypairPath}:`, err);
        process.exit(1);
        throw err; // unreachable — tells TypeScript this branch always exits
    }
    const payer = Keypair.fromSecretKey(Uint8Array.from(raw));

    const connection = new Connection(rpcUrl, "confirmed");

    // Derive PDA — same seeds as Rust contract.
    const [apartmentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("apartment"), Buffer.from(deviceId)],
        programId
    );

    console.log(`  PDA    : ${apartmentPda.toBase58()}`);
    console.log(`  Energy : ${energy.toString()} µWh`);

    // Anchor discriminator = first 8 bytes of SHA-256("global:update_meter_data").
    const discriminator = crypto
        .createHash("sha256")
        .update("global:update_meter_data")
        .digest()
        .slice(0, 8);

    // u64 little-endian.
    const energyBytes = Buffer.alloc(8);
    energyBytes.writeBigUInt64LE(energy);

    const data = Buffer.concat([discriminator, energyBytes]);

    const ix = new TransactionInstruction({
        programId,
        keys: [
            { pubkey: apartmentPda, isSigner: false, isWritable: true },
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        ],
        data,
    });

    // Retry loop with exponential back-off.
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const { blockhash, lastValidBlockHeight } =
                await connection.getLatestBlockhash();

            const tx = new Transaction({
                recentBlockhash: blockhash,
                feePayer: payer.publicKey,
            });
            tx.add(ix);
            tx.sign(payer);

            const sig = await connection.sendRawTransaction(tx.serialize(), {
                skipPreflight: false,
            });
            await connection.confirmTransaction(
                { signature: sig, blockhash, lastValidBlockHeight },
                "confirmed"
            );

            console.log(`  tx     : ${sig}`);
            return;
        } catch (err: unknown) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  [attempt ${attempt}/${MAX_RETRIES}] ${msg}`);
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_BASE_MS * attempt;
                console.log(`  Retrying in ${delay / 1000}s...`);
                await sleep(delay);
            }
        }
    }

    console.error("[ERROR] All retries exhausted.");
    throw lastErr;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
