/**
 * setup_devnet.ts — Initializes the full system on Devnet (or localnet).
 *
 * Creates:
 *   1. Fake USDC mint (6 decimals)
 *   2. $PROP token mint (0 decimals — fractional ownership shares)
 *   3. GlobalConfig PDA with tariff + oracle pubkey
 *   4. Service vault (USDC token account for 10% fee collection)
 *   5. Apartment PDA for a test device
 *   6. Token accounts for owner and tenant
 *   7. Mints test USDC to tenant
 *   8. Mints $PROP shares to owner
 *
 * Usage:
 *   npx ts-node scripts/setup_devnet.ts \
 *       --rpc http://127.0.0.1:8899 \
 *       --keypair ~/.config/solana/id.json \
 *       --program-id EMtr1111111111111111111111111111111111111111
 *
 * The admin keypair (--keypair) is used as:
 *   - Payer for all transactions
 *   - Mint authority for fake USDC and $PROP
 *   - Admin of the GlobalConfig
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    Connection,
    SystemProgram,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
    createMint,
    createAccount,
    mintTo,
    getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// ── CLI args ────────────────────────────────────────────────────────────────

interface SetupArgs {
    rpcUrl: string;
    keypairPath: string;
    programIdStr: string;
    deviceId: string;
    tariff: number;
}

function parseArgs(): SetupArgs {
    const args: SetupArgs = {
        rpcUrl: "http://127.0.0.1:8899",
        keypairPath: "~/.config/solana/id.json",
        programIdStr: "EMtr1111111111111111111111111111111111111111",
        deviceId: "APT-001",
        tariff: 500_000, // 0.50 USDC per POWER unit
    };

    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case "--rpc":        args.rpcUrl = argv[++i]; break;
            case "--keypair":    args.keypairPath = argv[++i]; break;
            case "--program-id": args.programIdStr = argv[++i]; break;
            case "--device-id":  args.deviceId = argv[++i]; break;
            case "--tariff":     args.tariff = parseInt(argv[++i], 10); break;
            default:
                console.error(`Unknown arg: ${argv[i]}`);
                process.exit(1);
        }
    }
    return args;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function loadKeypair(kpPath: string): Keypair {
    const resolved = kpPath.replace("~", process.env.HOME || process.env.USERPROFILE || "~");
    const raw = JSON.parse(fs.readFileSync(resolved, "utf-8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function airdropIfNeeded(connection: Connection, pubkey: PublicKey, minSol: number) {
    const balance = await connection.getBalance(pubkey);
    if (balance < minSol * LAMPORTS_PER_SOL) {
        console.log(`  Airdropping ${minSol} SOL to ${pubkey.toBase58().slice(0, 8)}...`);
        const sig = await connection.requestAirdrop(pubkey, minSol * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
    }
}

function saveKeypairToFile(kp: Keypair, name: string) {
    const dir = path.resolve("./keys");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
    console.log(`  Keypair saved: ${filePath}`);
    return filePath;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    const args = parseArgs();
    const programId = new PublicKey(args.programIdStr);
    const admin = loadKeypair(args.keypairPath);

    const connection = new Connection(args.rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(admin);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║       DEVNET SETUP — Tokenized Housing          ║");
    console.log("╠══════════════════════════════════════════════════╣");
    console.log(`║  RPC      : ${args.rpcUrl}`);
    console.log(`║  Program  : ${args.programIdStr.slice(0, 16)}...`);
    console.log(`║  Admin    : ${admin.publicKey.toBase58().slice(0, 16)}...`);
    console.log(`║  Device   : ${args.deviceId}`);
    console.log(`║  Tariff   : ${args.tariff / 1_000_000} USDC/POWER`);
    console.log("╚══════════════════════════════════════════════════╝\n");

    // ── 0. Ensure admin has SOL ────────────────────────────────────────────
    await airdropIfNeeded(connection, admin.publicKey, 5);

    // ── 1. Generate participant keypairs ────────────────────────────────────
    console.log("── Step 1: Generate participant keypairs ──");
    const oracle = Keypair.generate();
    const owner = Keypair.generate();
    const tenant = Keypair.generate();

    saveKeypairToFile(oracle, "oracle");
    saveKeypairToFile(owner, "owner");
    saveKeypairToFile(tenant, "tenant");

    // Airdrop SOL to participants
    for (const [name, kp] of [["oracle", oracle], ["owner", owner], ["tenant", tenant]] as const) {
        await airdropIfNeeded(connection, kp.publicKey, 2);
        console.log(`  ${name}: ${kp.publicKey.toBase58()}`);
    }

    // ── 2. Create fake USDC mint (6 decimals) ──────────────────────────────
    console.log("\n── Step 2: Create fake USDC mint ──");
    const usdcMint = await createMint(
        connection,
        admin,
        admin.publicKey, // mint authority
        null,            // freeze authority
        6                // decimals (like real USDC)
    );
    console.log(`  USDC Mint: ${usdcMint.toBase58()}`);

    // ── 3. Create $PROP token mint (0 decimals — whole shares) ─────────────
    console.log("\n── Step 3: Create $PROP token mint ──");
    const propMint = await createMint(
        connection,
        admin,
        admin.publicKey,
        null,
        0 // 0 decimals — each token = 1 share
    );
    console.log(`  $PROP Mint: ${propMint.toBase58()}`);

    // ── 4. Create USDC token accounts ──────────────────────────────────────
    console.log("\n── Step 4: Create USDC token accounts ──");
    const tenantUsdc = await createAccount(connection, tenant, usdcMint, tenant.publicKey);
    const ownerUsdc  = await createAccount(connection, owner, usdcMint, owner.publicKey);
    const serviceVault = await createAccount(connection, admin, usdcMint, admin.publicKey);

    console.log(`  Tenant USDC : ${tenantUsdc.toBase58()}`);
    console.log(`  Owner USDC  : ${ownerUsdc.toBase58()}`);
    console.log(`  Service Vault: ${serviceVault.toBase58()}`);

    // ── 5. Create $PROP token account for owner & mint shares ──────────────
    console.log("\n── Step 5: Mint $PROP shares to owner ──");
    const ownerPropAta = await getOrCreateAssociatedTokenAccount(
        connection, admin, propMint, owner.publicKey
    );
    await mintTo(connection, admin, propMint, ownerPropAta.address, admin, 100);
    console.log(`  Owner $PROP ATA: ${ownerPropAta.address.toBase58()} (100 shares)`);

    // ── 6. Mint test USDC to tenant ────────────────────────────────────────
    console.log("\n── Step 6: Mint 1000 USDC to tenant ──");
    await mintTo(connection, admin, usdcMint, tenantUsdc, admin, 1_000_000_000); // 1000 USDC
    console.log("  Minted 1000 USDC to tenant");

    // ── 7. Initialize GlobalConfig on-chain ────────────────────────────────
    console.log("\n── Step 7: Initialize GlobalConfig ──");

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

    const [globalConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("global_config")],
        programId
    );

    await program.methods
        .initializeConfig(new BN(args.tariff), oracle.publicKey)
        .accounts({
            globalConfig: globalConfigPda,
            usdcMint: usdcMint,
            serviceVault: serviceVault,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

    console.log(`  GlobalConfig PDA: ${globalConfigPda.toBase58()}`);
    console.log(`  Oracle set to   : ${oracle.publicKey.toBase58()}`);
    console.log(`  Tariff           : ${args.tariff}`);

    // ── 8. Initialize Apartment ────────────────────────────────────────────
    console.log("\n── Step 8: Initialize Apartment ──");

    const [apartmentPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("apartment"), Buffer.from(args.deviceId)],
        programId
    );

    await program.methods
        .initializeApartment(args.deviceId, owner.publicKey, tenant.publicKey)
        .accounts({
            apartment: apartmentPda,
            globalConfig: globalConfigPda,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

    console.log(`  Apartment PDA: ${apartmentPda.toBase58()}`);
    console.log(`  Device ID    : ${args.deviceId}`);
    console.log(`  Owner        : ${owner.publicKey.toBase58()}`);
    console.log(`  Tenant       : ${tenant.publicKey.toBase58()}`);

    // ── Summary ────────────────────────────────────────────────────────────
    const summary = {
        rpc: args.rpcUrl,
        programId: programId.toBase58(),
        globalConfig: globalConfigPda.toBase58(),
        apartmentPda: apartmentPda.toBase58(),
        usdcMint: usdcMint.toBase58(),
        propMint: propMint.toBase58(),
        serviceVault: serviceVault.toBase58(),
        oracle: oracle.publicKey.toBase58(),
        owner: owner.publicKey.toBase58(),
        tenant: tenant.publicKey.toBase58(),
        tenantUsdc: tenantUsdc.toBase58(),
        ownerUsdc: ownerUsdc.toBase58(),
        oracleKeypair: "./keys/oracle.json",
    };

    const summaryPath = "./keys/devnet_summary.json";
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║              SETUP COMPLETE ✓                   ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log(`\nSummary saved to: ${summaryPath}`);
    console.log("\nTo run C++ emulator:");
    console.log(`  ./smart_meter \\`);
    console.log(`    --device-id ${args.deviceId} \\`);
    console.log(`    --keypair ./keys/oracle.json \\`);
    console.log(`    --program-id ${programId.toBase58()} \\`);
    console.log(`    --rpc ${args.rpcUrl}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
