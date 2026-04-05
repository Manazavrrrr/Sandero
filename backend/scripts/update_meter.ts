/**
 * update_meter.ts — Anchor client to call `update_meter_data`.
 *
 * Usage (called by sync_meter.sh):
 *   npx ts-node scripts/update_meter.ts <device_id> <energy_micro_wh> <keypair_path> <program_id> <rpc_url>
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import * as fs from "fs";

async function main() {
    const [, , deviceId, energyStr, keypairPath, programIdStr, rpcUrl] = process.argv;

    if (!deviceId || !energyStr || !keypairPath || !programIdStr || !rpcUrl) {
        console.error("Usage: update_meter.ts <device_id> <energy> <keypair> <program_id> <rpc>");
        process.exit(1);
    }

    const energy = new anchor.BN(energyStr);
    const programId = new PublicKey(programIdStr);

    // Load keypair.
    const raw = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    const payer = Keypair.fromSecretKey(Uint8Array.from(raw));

    // Connection + provider.
    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(payer);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Load IDL from built artifacts.
    const idl = JSON.parse(
        fs.readFileSync("./anchor-contract/target/idl/energy_meter.json", "utf-8")
    );
    const program = new Program(idl, programId, provider);

    // Derive PDA.
    const [apartmentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("apartment"), Buffer.from(deviceId)],
        programId
    );

    console.log(`  PDA: ${apartmentPda.toBase58()}`);
    console.log(`  Energy: ${energy.toString()} µWh`);

    // Send transaction.
    const tx = await program.methods
        .updateMeterData(energy)
        .accounts({
            apartment: apartmentPda,
            authority: payer.publicKey,
        })
        .signers([payer])
        .rpc();

    console.log(`  tx: ${tx}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
