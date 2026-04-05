import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idl from "./idl/energy_meter.json";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
    "EMtr1111111111111111111111111111111111111111"
);

// ── PDA derivation helpers ──────────────────────────────────────────────────

export function deriveGlobalConfigPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("global_config")],
    PROGRAM_ID
  );
}

export function deriveApartmentPda(deviceId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("apartment"), Buffer.from(deviceId)],
    PROGRAM_ID
  );
}

// ── Create an Anchor Program instance from a wallet + connection ────────────

export function getProgram(connection, wallet) {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  // Anchor 0.30+ requires programId to come from idl.address; inject it at runtime
  const idlWithAddress = { ...idl, address: PROGRAM_ID.toBase58() };
  return new Program(idlWithAddress, provider);
}

// ── Read on-chain data ──────────────────────────────────────────────────────

export async function fetchGlobalConfig(connection, wallet) {
  const program = getProgram(connection, wallet);
  const [pda] = deriveGlobalConfigPda();
  try {
    return await program.account.globalConfig.fetch(pda);
  } catch {
    return null;
  }
}

export async function fetchApartment(connection, wallet, deviceId) {
  const program = getProgram(connection, wallet);
  const [pda] = deriveApartmentPda(deviceId);
  try {
    return await program.account.apartment.fetch(pda);
  } catch {
    return null;
  }
}

export async function fetchAllApartments(connection, wallet) {
  const program = getProgram(connection, wallet);
  try {
    return await program.account.apartment.all();
  } catch {
    return [];
  }
}

// ── Transactions ────────────────────────────────────────────────────────────

/**
 * Tenant pays utility bill.
 * @param {Connection} connection
 * @param {WalletAdapter} wallet  - must have signTransaction
 * @param {string} deviceId       - apartment device ID
 * @param {number} amountUsdc     - amount in USDC lamports (6 decimals)
 * @param {PublicKey} tenantUsdcAta  - tenant's USDC token account
 * @param {PublicKey} ownerUsdcAta   - owner's USDC token account
 * @param {PublicKey} serviceVault   - service vault USDC token account
 */
export async function payUtilities(
  connection,
  wallet,
  deviceId,
  amountUsdc,
  tenantUsdcAta,
  ownerUsdcAta,
  serviceVault
) {
  const program = getProgram(connection, wallet);
  const [apartmentPda] = deriveApartmentPda(deviceId);

  const tx = await program.methods
    .payUtilities(new BN(amountUsdc))
    .accounts({
      apartment: apartmentPda,
      tenant: wallet.publicKey,
      tenantUsdc: tenantUsdcAta,
      ownerUsdc: ownerUsdcAta,
      serviceVault: serviceVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  return tx;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Convert accumulated_power (u64 micro-Wh) to kWh */
export function microWhToKwh(microWh) {
  // microWh is in µWh. 1 kWh = 1e9 µWh
  return Number(microWh) / 1_000_000_000;
}

/** Convert USDC lamports (6 dec) to human-readable dollars */
export function usdcToDisplay(lamports) {
  return (Number(lamports) / 1_000_000).toFixed(2);
}

/** Tariff: price per 1 unit of POWER in USDC display */
export function tariffToDisplay(tariffLamports) {
  return (Number(tariffLamports) / 1_000_000).toFixed(4);
}
