/**
 * update_meter.ts — Anchor client to call `record_consumption`.
 *
 * Usage (called by sync_meter.sh):
 *   npx ts-node scripts/update_meter.ts <device_id> <amount> <keypair_path> <program_id> <rpc_url>
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    const [, , deviceId, amountStr, keypairPath, programIdStr, rpcUrl] = process.argv;

    if (!deviceId || !amountStr || !keypairPath || !programIdStr || !rpcUrl) {
        console.error("Usage: update_meter.ts <device_id> <amount> <keypair> <program_id> <rpc>");
        process.exit(1);
    }

    const amount = new anchor.BN(amountStr);
    const programId = new PublicKey(programIdStr);

    // Load oracle keypair.
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const oracle = Keypair.fromSecretKey(Uint8Array.from(raw));

    // Connection + provider.
    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(oracle);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Load IDL from built artifacts.
    const idlPath = "./anchor-contract/target/idl/energy_meter.json";
    let idl: anchor.Idl;
    try {
        idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as anchor.Idl;
    } catch {
        console.error(`[ERROR] Cannot read IDL at ${idlPath}.`);
        console.error("        Run: cd anchor-contract && anchor build");
        process.exit(1);
        throw new Error("unreachable");
    }

    const program = new Program(idl, programId, provider);

    // Derive PDAs.
    const [apartmentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("apartment"), Buffer.from(deviceId)],
        programId
    );

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("global_config")],
        programId
    );

    console.log(`  Apartment PDA : ${apartmentPda.toBase58()}`);
    console.log(`  GlobalConfig  : ${globalConfigPda.toBase58()}`);
    console.log(`  Amount        : ${amount.toString()} POWER`);

    // Retry loop.
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const tx = await program.methods
                .recordConsumption(amount)
                .accounts({
                    apartment: apartmentPda,
                    globalConfig: globalConfigPda,
                    oracle: oracle.publicKey,
                })
                .signers([oracle])
                .rpc();

            console.log(`  tx: ${tx}`);
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
