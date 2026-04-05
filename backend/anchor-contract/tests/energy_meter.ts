/**
 * energy_meter.ts — integration tests for the EnergyMeter Anchor program.
 *
 * Сценарий: Счётчик начислил -> Жилец оплатил -> Инвестор получил профит.
 *
 * Run:  cd anchor-contract && anchor test
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
    Keypair,
    PublicKey,
    SystemProgram,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
    createMint,
    createAccount,
    mintTo,
    getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

type EnergyMeter = anchor.Idl;

describe("energy_meter — full flow", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.EnergyMeter as Program<EnergyMeter>;
    const admin = (provider.wallet as anchor.Wallet).payer;

    // Oracle keypair — имитирует C++ счётчик
    const oracle = Keypair.generate();
    // Инвестор (владелец квартиры)
    const owner = Keypair.generate();
    // Жилец
    const tenant = Keypair.generate();

    const DEVICE_ID = "APT-001";
    const TARIFF = 500_000; // 0.50 USDC за 1 POWER (USDC = 6 decimals)

    let globalConfigPda: PublicKey;
    let apartmentPda: PublicKey;
    let usdcMint: PublicKey;
    let tenantUsdc: PublicKey;
    let ownerUsdc: PublicKey;
    let serviceVault: PublicKey;

    // ── Setup ───────────────────────────────────────────────────────────────

    before(async () => {
        // Derive PDAs
        [globalConfigPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("global_config")],
            program.programId
        );
        [apartmentPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("apartment"), Buffer.from(DEVICE_ID)],
            program.programId
        );

        // Airdrop SOL to all participants
        for (const kp of [oracle, owner, tenant]) {
            const sig = await provider.connection.requestAirdrop(
                kp.publicKey,
                2 * LAMPORTS_PER_SOL
            );
            await provider.connection.confirmTransaction(sig, "confirmed");
        }

        // Create a fake USDC mint (admin is mint authority)
        usdcMint = await createMint(
            provider.connection,
            admin,
            admin.publicKey, // mint authority
            null,
            6 // 6 decimals like real USDC
        );

        // Create USDC token accounts
        tenantUsdc = await createAccount(
            provider.connection,
            tenant,
            usdcMint,
            tenant.publicKey
        );
        ownerUsdc = await createAccount(
            provider.connection,
            owner,
            usdcMint,
            owner.publicKey
        );
        serviceVault = await createAccount(
            provider.connection,
            admin,
            usdcMint,
            admin.publicKey // service vault owned by admin
        );

        // Mint 100 USDC to tenant
        await mintTo(
            provider.connection,
            admin,
            usdcMint,
            tenantUsdc,
            admin,
            100_000_000 // 100 USDC
        );
    });

    // ── 1. Initialize GlobalConfig ──────────────────────────────────────────

    it("initializes global config with tariff and oracle", async () => {
        await program.methods
            .initializeConfig(new BN(TARIFF), oracle.publicKey)
            .accounts({
                globalConfig: globalConfigPda,
                admin: admin.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();

        const config = await program.account.globalConfig.fetch(globalConfigPda);
        assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
        assert.equal(config.oracle.toBase58(), oracle.publicKey.toBase58());
        assert.equal(config.tariffUsdcPerPower.toString(), TARIFF.toString());
    });

    // ── 2. Initialize Apartment ─────────────────────────────────────────────

    it("initializes an apartment with owner and tenant", async () => {
        await program.methods
            .initializeApartment(DEVICE_ID, owner.publicKey, tenant.publicKey)
            .accounts({
                apartment: apartmentPda,
                globalConfig: globalConfigPda,
                admin: admin.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([admin])
            .rpc();

        const apt = await program.account.apartment.fetch(apartmentPda);
        assert.equal(apt.deviceId, DEVICE_ID);
        assert.equal(apt.ownerPubkey.toBase58(), owner.publicKey.toBase58());
        assert.equal(apt.tenantPubkey.toBase58(), tenant.publicKey.toBase58());
        assert.equal(apt.accumulatedPower.toString(), "0");
        assert.equal(apt.unpaidBalanceUsdc.toString(), "0");
    });

    // ── 3. Oracle records consumption ───────────────────────────────────────

    it("oracle records 10 POWER consumption", async () => {
        const amount = new BN(10);

        await program.methods
            .recordConsumption(amount)
            .accounts({
                apartment: apartmentPda,
                globalConfig: globalConfigPda,
                oracle: oracle.publicKey,
            })
            .signers([oracle])
            .rpc();

        const apt = await program.account.apartment.fetch(apartmentPda);
        assert.equal(apt.accumulatedPower.toString(), "10");
        // 10 * 500_000 = 5_000_000 (5.00 USDC)
        assert.equal(apt.unpaidBalanceUsdc.toString(), "5000000");
    });

    it("rejects consumption from non-oracle", async () => {
        const stranger = Keypair.generate();
        const sig = await provider.connection.requestAirdrop(
            stranger.publicKey,
            LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig, "confirmed");

        try {
            await program.methods
                .recordConsumption(new BN(5))
                .accounts({
                    apartment: apartmentPda,
                    globalConfig: globalConfigPda,
                    oracle: stranger.publicKey,
                })
                .signers([stranger])
                .rpc();
            assert.fail("Expected error");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            assert.ok(
                msg.includes("UnauthorizedOracle") ||
                    msg.includes("ConstraintRaw") ||
                    msg.includes("A raw constraint was violated"),
                `Unexpected error: ${msg}`
            );
        }
    });

    // ── 4. Tenant pays utilities ────────────────────────────────────────────

    it("tenant pays 5 USDC — owner gets 95%, service gets 5%", async () => {
        const paymentAmount = new BN(5_000_000); // 5.00 USDC

        const ownerBefore = (await getAccount(provider.connection, ownerUsdc)).amount;
        const serviceBefore = (await getAccount(provider.connection, serviceVault)).amount;

        await program.methods
            .payUtilities(paymentAmount)
            .accounts({
                apartment: apartmentPda,
                tenant: tenant.publicKey,
                tenantUsdc: tenantUsdc,
                ownerUsdc: ownerUsdc,
                serviceVault: serviceVault,
                tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            })
            .signers([tenant])
            .rpc();

        // Check apartment debt cleared
        const apt = await program.account.apartment.fetch(apartmentPda);
        assert.equal(apt.unpaidBalanceUsdc.toString(), "0");

        // Check owner received 95% = 4_750_000
        const ownerAfter = (await getAccount(provider.connection, ownerUsdc)).amount;
        assert.equal(
            (ownerAfter - ownerBefore).toString(),
            "4750000"
        );

        // Check service vault received 5% = 250_000
        const serviceAfter = (await getAccount(provider.connection, serviceVault)).amount;
        assert.equal(
            (serviceAfter - serviceBefore).toString(),
            "250000"
        );
    });

    it("rejects payment from non-tenant", async () => {
        // First record some consumption so there's a debt
        await program.methods
            .recordConsumption(new BN(2))
            .accounts({
                apartment: apartmentPda,
                globalConfig: globalConfigPda,
                oracle: oracle.publicKey,
            })
            .signers([oracle])
            .rpc();

        try {
            await program.methods
                .payUtilities(new BN(1_000_000))
                .accounts({
                    apartment: apartmentPda,
                    tenant: owner.publicKey, // wrong signer
                    tenantUsdc: ownerUsdc,
                    ownerUsdc: ownerUsdc,
                    serviceVault: serviceVault,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                })
                .signers([owner])
                .rpc();
            assert.fail("Expected error");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            assert.ok(
                msg.includes("NotTenant") ||
                    msg.includes("ConstraintRaw") ||
                    msg.includes("A raw constraint was violated"),
                `Unexpected error: ${msg}`
            );
        }
    });

    it("rejects overpayment", async () => {
        const apt = await program.account.apartment.fetch(apartmentPda);
        const overAmount = new BN(apt.unpaidBalanceUsdc.toString()).add(new BN(1));

        try {
            await program.methods
                .payUtilities(overAmount)
                .accounts({
                    apartment: apartmentPda,
                    tenant: tenant.publicKey,
                    tenantUsdc: tenantUsdc,
                    ownerUsdc: ownerUsdc,
                    serviceVault: serviceVault,
                    tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
                })
                .signers([tenant])
                .rpc();
            assert.fail("Expected error");
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            assert.ok(
                msg.includes("OverPayment") ||
                    msg.includes("Payment amount exceeds"),
                `Unexpected error: ${msg}`
            );
        }
    });

    // ── 5. Admin updates tariff ─────────────────────────────────────────────

    it("admin can update tariff", async () => {
        const newTariff = new BN(750_000); // 0.75 USDC per POWER

        await program.methods
            .updateTariff(newTariff)
            .accounts({
                globalConfig: globalConfigPda,
                admin: admin.publicKey,
            })
            .signers([admin])
            .rpc();

        const config = await program.account.globalConfig.fetch(globalConfigPda);
        assert.equal(config.tariffUsdcPerPower.toString(), "750000");
    });

    it("new tariff applies to next consumption", async () => {
        const aptBefore = await program.account.apartment.fetch(apartmentPda);
        const debtBefore = new BN(aptBefore.unpaidBalanceUsdc.toString());

        await program.methods
            .recordConsumption(new BN(4))
            .accounts({
                apartment: apartmentPda,
                globalConfig: globalConfigPda,
                oracle: oracle.publicKey,
            })
            .signers([oracle])
            .rpc();

        const aptAfter = await program.account.apartment.fetch(apartmentPda);
        // 4 * 750_000 = 3_000_000
        const expectedDebt = debtBefore.add(new BN(3_000_000));
        assert.equal(aptAfter.unpaidBalanceUsdc.toString(), expectedDebt.toString());
    });
});
