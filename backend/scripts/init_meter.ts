/**
 * init_meter.ts — Anchor client to call `initialize`.
 *
 * Usage (called by init_meter.sh):
 *   npx ts-node scripts/init_meter.ts <device_id> <keypair_path> <program_id> <rpc_url>
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
    const [, , deviceId, keypairPath, programIdStr, rpcUrl] = process.argv;

    if (!deviceId || !keypairPath || !programIdStr || !rpcUrl) {
        console.error(
            "Usage: init_meter.ts <device_id> <keypair_path> <program_id> <rpc_url>"
        );
        process.exit(1);
    }

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

    // Connection + provider.
    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(payer);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Load IDL from built artifacts.
    const idlPath = "./anchor-contract/target/idl/energy_meter.json";
    let idl: anchor.Idl;
    try {
        idl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as anchor.Idl;
    } catch (err) {
        console.error(`[ERROR] Cannot read IDL at ${idlPath}.`);
        console.error("        Run: cd anchor-contract && anchor build");
        process.exit(1);
        throw err; // unreachable — tells TypeScript this branch always exits
    }

    const program = new Program(idl, programId, provider);

    // Derive PDA — same seeds as Rust contract.
    const [apartmentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("apartment"), Buffer.from(deviceId)],
        programId
    );

    console.log(`  Device ID : ${deviceId}`);
    console.log(`  PDA       : ${apartmentPda.toBase58()}`);
    console.log(`  Authority : ${payer.publicKey.toBase58()}`);

    // Retry loop with exponential back-off.
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const tx = await program.methods
                .initialize(deviceId)
                .accounts({
                    apartment: apartmentPda,
                    authority: payer.publicKey,
                    systemProgram: anchor.web3.SystemProgram.programId,
                })
                .signers([payer])
                .rpc();

            console.log(`  tx        : ${tx}`);
            console.log("  Meter initialized successfully.");
            return;
        } catch (err: unknown) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);

            // The account already exists — treat as success.
            if (msg.includes("already in use") || msg.includes("already been initialized")) {
                console.log("  Meter account already exists on-chain. Nothing to do.");
                return;
            }

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
