"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
  fetchGlobalConfig,
  fetchApartment,
  fetchAllApartments,
  payUtilities,
  microWhToKwh,
  usdcToDisplay,
  PROGRAM_ID,
  deriveApartmentPda,
} from "../lib/program";
import { getAssociatedTokenAddress } from "@solana/spl-token";

// ── Default device ID (matches C++ emulator) ────────────────────────────────
const DEFAULT_DEVICE_ID =
  process.env.NEXT_PUBLIC_DEVICE_ID || "APT-42-7F";

// ── Fallback mock data (used when on-chain accounts don't exist yet) ────────
const MOCK_HISTORY = [
  { month: "Ноя", kwh: 132, cost: 13.2 },
  { month: "Дек", kwh: 158, cost: 15.8 },
  { month: "Янв", kwh: 175, cost: 17.5 },
  { month: "Фев", kwh: 141, cost: 14.1 },
  { month: "Мар", kwh: 129, cost: 12.9 },
  { month: "Апр", kwh: 147, cost: 14.7 },
];

const MOCK_DIVIDENDS = [
  { month: "Ноя", amount: 18.4 },
  { month: "Дек", amount: 22.1 },
  { month: "Янв", amount: 24.8 },
  { month: "Фев", amount: 19.6 },
  { month: "Мар", amount: 21.3 },
  { month: "Апр", amount: 20.9 },
];

// ── Mini chart component ────────────────────────────────────────────────────
function BarChart({ data, valueKey, labelKey, color, suffix = "" }) {
  const max = Math.max(...data.map((d) => d[valueKey]));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, padding: "8px 0" }}>
      {data.map((d, i) => {
        const h = (d[valueKey] / max) * 100;
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              {d[valueKey]}{suffix}
            </span>
            <div
              style={{
                width: "100%",
                height: `${h}%`,
                background: `linear-gradient(180deg, ${color}, ${color}44)`,
                borderRadius: "4px 4px 2px 2px",
                minHeight: 4,
                transition: "height 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
            <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              {d[labelKey]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 20px",
        flex: 1,
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent || "var(--text)", fontFamily: "'Space Mono', monospace" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function PulsingDot({ color }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        boxShadow: `0 0 8px ${color}88`,
        animation: "pulse 2s ease-in-out infinite",
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Dashboard
// ═══════════════════════════════════════════════════════════════════════════

export default function PropChainDashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey, connected, disconnect } = wallet;

  // Prevent SSR/client hydration mismatch for wallet UI
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Auth / role
  const [role, setRole] = useState(null);

  // On-chain data
  const [globalConfig, setGlobalConfig] = useState(null);
  const [apartment, setApartment] = useState(null);
  const [allApartments, setAllApartments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Payment state
  const [paymentDone, setPaymentDone] = useState(false);
  const [paymentTx, setPaymentTx] = useState(null);
  const [paying, setPaying] = useState(false);

  // Live kWh (polls on-chain every 10s, shows real accumulated_power)
  const [liveKwh, setLiveKwh] = useState(0);

  // Investor: tenant management (local state, could be extended to on-chain)
  const [tenants, setTenants] = useState([]);
  const [newTenantWallet, setNewTenantWallet] = useState("");
  const [newTenantApt, setNewTenantApt] = useState("");

  // ── Fetch on-chain data ─────────────────────────────────────────────────
  const loadOnChainData = useCallback(async () => {
    if (!connected || !publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const config = await fetchGlobalConfig(connection, wallet);
      setGlobalConfig(config);

      const apt = await fetchApartment(connection, wallet, DEFAULT_DEVICE_ID);
      setApartment(apt);

      if (apt) {
        setLiveKwh(microWhToKwh(apt.accumulatedPower));
      }

      if (role === "investor") {
        const all = await fetchAllApartments(connection, wallet);
        setAllApartments(all);

        // Build tenant list from on-chain apartments
        const tenantList = all
          .filter((a) => a.account.tenantPubkey)
          .map((a) => ({
            wallet: a.account.tenantPubkey.toBase58().slice(0, 4) + "..." + a.account.tenantPubkey.toBase58().slice(-4),
            apartment: a.account.deviceId,
            fullWallet: a.account.tenantPubkey.toBase58(),
          }));
        setTenants(tenantList);
      }
    } catch (err) {
      console.error("Failed to load on-chain data:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [connected, publicKey, connection, wallet, role]);

  // Initial load + polling
  useEffect(() => {
    loadOnChainData();
    const iv = setInterval(loadOnChainData, 10_000);
    return () => clearInterval(iv);
  }, [loadOnChainData]);

  // ── Pay utilities ───────────────────────────────────────────────────────
  const handlePay = async () => {
    if (!apartment || !globalConfig || !publicKey) return;

    setPaying(true);
    setError(null);
    try {
      const amountToPay = apartment.unpaidBalanceUsdc;
      if (Number(amountToPay) === 0) {
        setError("Нет задолженности для оплаты");
        setPaying(false);
        return;
      }

      // Derive USDC ATAs
      const usdcMint = globalConfig.usdcMint;
      const tenantUsdcAta = await getAssociatedTokenAddress(usdcMint, publicKey);
      const ownerUsdcAta = await getAssociatedTokenAddress(usdcMint, apartment.ownerPubkey);
      const serviceVault = globalConfig.serviceVault;

      const tx = await payUtilities(
        connection,
        wallet,
        DEFAULT_DEVICE_ID,
        amountToPay,
        tenantUsdcAta,
        ownerUsdcAta,
        serviceVault
      );

      setPaymentTx(tx);
      setPaymentDone(true);
      // Refresh data
      await loadOnChainData();
    } catch (err) {
      console.error("Payment failed:", err);
      setError("Ошибка оплаты: " + err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleLogout = () => {
    disconnect();
    setRole(null);
    setPaymentDone(false);
    setPaymentTx(null);
    setApartment(null);
    setGlobalConfig(null);
    setError(null);
  };

  const handleAddTenant = () => {
    if (!newTenantWallet.trim()) return;
    const short = newTenantWallet.length > 12
      ? newTenantWallet.slice(0, 4) + "..." + newTenantWallet.slice(-4)
      : newTenantWallet;
    setTenants((prev) => [
      ...prev,
      {
        wallet: short,
        apartment: newTenantApt.trim() || "Не указана",
        fullWallet: newTenantWallet,
      },
    ]);
    setNewTenantWallet("");
    setNewTenantApt("");
  };

  const handleRemoveTenant = (index) => {
    setTenants((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Derived display values ────────────────────────────────────────────────
  const shortWallet = publicKey
    ? publicKey.toBase58().slice(0, 4) + "..." + publicKey.toBase58().slice(-4)
    : null;

  const tariffRate = globalConfig
    ? Number(globalConfig.tariffUsdcPerPower) / 1_000_000
    : 0.10;

  const debtUsdc = apartment
    ? Number(apartment.unpaidBalanceUsdc) / 1_000_000
    : liveKwh * tariffRate;

  const totalPower = apartment ? Number(apartment.accumulatedPower) : 0;

  // Investor aggregated data
  const investorTotalPower = allApartments.reduce(
    (sum, a) => sum + Number(a.account.accumulatedPower || 0), 0
  );
  const investorTotalDebt = allApartments.reduce(
    (sum, a) => sum + Number(a.account.unpaidBalanceUsdc || 0), 0
  );
  const occupiedApts = allApartments.filter(
    (a) => a.account.tenantPubkey && !a.account.tenantPubkey.equals(PublicKey.default)
  ).length;
  const occupancy = allApartments.length > 0
    ? Math.round((occupiedApts / allApartments.length) * 100)
    : 0;

  // ═══════════════════════════════════════════════════════════════════════
  // AUTH SCREEN
  // ═══════════════════════════════════════════════════════════════════════
  if (!connected || !role) {
    return (
      <div
        style={{
          "--bg": "#0a0b0f",
          "--card": "#12131a",
          "--border": "#1e2030",
          "--text": "#e8e9ed",
          "--muted": "#6b7084",
          "--accent": "#00e5a0",
          "--accent2": "#7c5cfc",
          "--danger": "#ff4d6a",
          "--warning": "#fbbf24",
          minHeight: "100vh",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&family=Space+Mono:wght@700&display=swap');
          @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
          @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
          * { box-sizing: border-box; margin: 0; padding: 0; }
        `}</style>

        <div style={{ maxWidth: 420, width: "100%", animation: "fadeUp 0.5s ease" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 40, justifyContent: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: "linear-gradient(135deg, #00e5a0, #7c5cfc)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 700,
                color: "#0a0b0f",
                fontFamily: "'Space Mono', monospace",
              }}
            >
              P
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: -0.3 }}>PropChain</div>
              <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                Solana · Devnet
              </div>
            </div>
          </div>

          {/* Auth card */}
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 32,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6, textAlign: "center" }}>
              Вход в систему
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 28, textAlign: "center" }}>
              Подключите Phantom Wallet и выберите роль
            </div>

            {!connected ? (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                {mounted && (
                  <WalletMultiButton
                    style={{
                      background: "linear-gradient(135deg, #7c5cfc, #00e5a0)",
                      borderRadius: 12,
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: 15,
                      fontWeight: 600,
                      padding: "14px 28px",
                    }}
                  />
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <PulsingDot color="var(--accent)" />
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>
                      {shortWallet}
                    </span>
                  </div>
                </div>

                {/* Tenant button */}
                <button
                  onClick={() => setRole("tenant")}
                  style={{
                    width: "100%",
                    padding: "16px 20px",
                    borderRadius: 12,
                    border: "1px solid #00e5a044",
                    background: "linear-gradient(135deg, #00e5a018, #00e5a008)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    textAlign: "left",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#00e5a088";
                    e.currentTarget.style.background = "linear-gradient(135deg, #00e5a025, #00e5a010)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#00e5a044";
                    e.currentTarget.style.background = "linear-gradient(135deg, #00e5a018, #00e5a008)";
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                    Войти как Арендатор
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Оплата КУ, счётчик потребления, история
                  </div>
                </button>

                {/* Investor button */}
                <button
                  onClick={() => setRole("investor")}
                  style={{
                    width: "100%",
                    padding: "16px 20px",
                    borderRadius: 12,
                    border: "1px solid #7c5cfc44",
                    background: "linear-gradient(135deg, #7c5cfc18, #7c5cfc08)",
                    color: "var(--text)",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    textAlign: "left",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#7c5cfc88";
                    e.currentTarget.style.background = "linear-gradient(135deg, #7c5cfc25, #7c5cfc10)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#7c5cfc44";
                    e.currentTarget.style.background = "linear-gradient(135deg, #7c5cfc18, #7c5cfc08)";
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                    Войти как Инвестор
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Доли, дивиденды, управление арендаторами
                  </div>
                </button>
              </div>
            )}

            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 20, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
              {connected ? "Phantom подключён" : "Подключите кошелёк для начала работы"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // MAIN DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════
  return (
    <div
      style={{
        "--bg": "#0a0b0f",
        "--card": "#12131a",
        "--border": "#1e2030",
        "--text": "#e8e9ed",
        "--muted": "#6b7084",
        "--accent": "#00e5a0",
        "--accent2": "#7c5cfc",
        "--danger": "#ff4d6a",
        "--warning": "#fbbf24",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
        padding: "0 16px 40px",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&family=Space+Mono:wght@700&display=swap');
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 0",
          borderBottom: "1px solid var(--border)",
          marginBottom: 28,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #00e5a0, #7c5cfc)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
              color: "#0a0b0f",
              fontFamily: "'Space Mono', monospace",
            }}
          >
            P
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.3 }}>PropChain</div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
              Solana · Devnet
            </div>
          </div>
        </div>

        {/* Role badge */}
        <div
          style={{
            padding: "8px 18px",
            borderRadius: 8,
            background: role === "tenant" ? "var(--accent)" : "var(--accent2)",
            color: "#0a0b0f",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          {role === "tenant" ? "Арендатор" : "Инвестор"}
        </div>

        {/* Wallet + logout */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <PulsingDot color="var(--accent)" />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{shortWallet}</span>
          <button
            onClick={handleLogout}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Выйти
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          maxWidth: 720,
          margin: "0 auto 16px",
          padding: "12px 16px",
          borderRadius: 10,
          background: "#ff4d6a15",
          border: "1px solid #ff4d6a33",
          color: "var(--danger)",
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !apartment && !globalConfig && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <PulsingDot color="var(--accent2)" />
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
            Загрузка данных из блокчейна...
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: 720, margin: "0 auto", animation: "fadeUp 0.5s ease" }} key={role}>
        {role === "tenant" ? (
          /* ═══════════════════════════════════════════════════════════════
             TENANT VIEW
             ═══════════════════════════════════════════════════════════════ */
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Title */}
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                Мой Дом
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>SolVilla Residence</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                Квартира {apartment?.deviceId || DEFAULT_DEVICE_ID}
                {apartment && (
                  <span style={{ marginLeft: 12, color: "var(--accent)", fontSize: 11 }}>
                    ON-CHAIN
                  </span>
                )}
                {!apartment && (
                  <span style={{ marginLeft: 12, color: "var(--warning)", fontSize: 11 }}>
                    Аккаунт не найден — используются демо-данные
                  </span>
                )}
              </div>
            </div>

            {/* Live meter */}
            <div
              style={{
                background: "linear-gradient(135deg, #00e5a022, #00e5a008)",
                border: "1px solid #00e5a033",
                borderRadius: 14,
                padding: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <PulsingDot color="var(--accent)" />
                  <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                    Счётчик · {apartment ? "On-Chain" : "Demo"}
                  </span>
                </div>
                <div style={{ fontSize: 38, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "var(--accent)" }}>
                  {liveKwh.toFixed(1)}
                  <span style={{ fontSize: 16, color: "var(--muted)", marginLeft: 6 }}>кВт·ч</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  = {liveKwh.toFixed(1)} $POWER токенов
                  {apartment && (
                    <span> · Тариф: {tariffRate.toFixed(4)} USDC/POWER</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>К ОПЛАТЕ</div>
                <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: paymentDone ? "var(--accent)" : "var(--warning)" }}>
                  {paymentDone ? "✓" : `$${debtUsdc.toFixed(2)}`}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{paymentDone ? "Оплачено" : "USDC"}</div>
              </div>
            </div>

            {/* Pay button */}
            {!paymentDone && debtUsdc > 0 && (
              <button
                onClick={handlePay}
                disabled={paying}
                style={{
                  width: "100%",
                  padding: "16px",
                  borderRadius: 12,
                  border: "none",
                  background: paying
                    ? "linear-gradient(135deg, #6b7084, #4a4f5e)"
                    : "linear-gradient(135deg, #00e5a0, #00c48c)",
                  color: "#0a0b0f",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: paying ? "wait" : "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  opacity: paying ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!paying) {
                    e.target.style.transform = "translateY(-1px)";
                    e.target.style.boxShadow = "0 6px 24px #00e5a044";
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = "translateY(0)";
                  e.target.style.boxShadow = "none";
                }}
              >
                {paying
                  ? "Подтвердите транзакцию в кошельке..."
                  : `Оплатить ${debtUsdc.toFixed(2)} USDC`}
              </button>
            )}

            {paymentDone && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 12,
                  background: "#00e5a015",
                  border: "1px solid #00e5a033",
                  textAlign: "center",
                  color: "var(--accent)",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Транзакция подтверждена · {debtUsdc.toFixed(2)} USDC списано
                {paymentTx && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                    tx: {paymentTx.slice(0, 16)}...{paymentTx.slice(-8)}
                  </div>
                )}
              </div>
            )}

            {/* History chart */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                Потребление по месяцам
              </div>
              <BarChart data={MOCK_HISTORY} valueKey="kwh" labelKey="month" color="#00e5a0" suffix="" />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                <span>Ср: {(MOCK_HISTORY.reduce((a, b) => a + b.kwh, 0) / MOCK_HISTORY.length).toFixed(0)} кВт·ч</span>
                <span>Итого: ${MOCK_HISTORY.reduce((a, b) => a + b.cost, 0).toFixed(1)} USDC</span>
              </div>
            </div>

            {/* On-chain info card */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
                fontSize: 12,
                color: "var(--muted)",
                lineHeight: 1.7,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                On-Chain данные
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontFamily: "'JetBrains Mono', monospace" }}>
                <div>Program: {PROGRAM_ID.toBase58().slice(0, 8)}...{PROGRAM_ID.toBase58().slice(-4)}</div>
                <div>Device ID: {apartment?.deviceId || DEFAULT_DEVICE_ID}</div>
                <div>Accumulated: {totalPower.toLocaleString()} µWh ({liveKwh.toFixed(4)} kWh)</div>
                <div>Debt: {debtUsdc.toFixed(6)} USDC</div>
                {apartment && (
                  <>
                    <div>Owner: {apartment.ownerPubkey.toBase58().slice(0, 8)}...{apartment.ownerPubkey.toBase58().slice(-4)}</div>
                    <div>Tenant: {apartment.tenantPubkey.toBase58().slice(0, 8)}...{apartment.tenantPubkey.toBase58().slice(-4)}</div>
                  </>
                )}
                {globalConfig && (
                  <div>Tariff: {tariffRate} USDC/POWER</div>
                )}
              </div>
            </div>

            {/* How it works */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
                fontSize: 12,
                color: "var(--muted)",
                lineHeight: 1.7,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                Как это работает?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div>C++ эмулятор считывает показания каждую секунду</div>
                <div>Oracle записывает потребление в Solana контракт (record_consumption)</div>
                <div>Вы оплачиваете USDC через pay_utilities — 95% инвестору, 5% сервису</div>
                <div>Каждая транзакция видна в Solana Explorer — полная прозрачность</div>
              </div>
            </div>
          </div>
        ) : (
          /* ═══════════════════════════════════════════════════════════════
             INVESTOR VIEW
             ═══════════════════════════════════════════════════════════════ */
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Title */}
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                Мои Инвестиции
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>SolVilla Residence</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                {allApartments.length > 0
                  ? `${allApartments.length} квартир(а) в сети`
                  : "Данные загружаются..."}
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatCard
                label="Квартир"
                value={allApartments.length || "—"}
                sub="зарегистрировано on-chain"
                accent="var(--accent2)"
              />
              <StatCard
                label="Суммарное потребление"
                value={`${(investorTotalPower / 1e9).toFixed(1)}`}
                sub="кВт·ч (все квартиры)"
                accent="var(--accent)"
              />
              <StatCard
                label="Загрузка"
                value={`${occupancy}%`}
                sub="квартир арендовано"
                accent="var(--warning)"
              />
            </div>

            {/* Total debt / revenue card */}
            <div
              style={{
                background: "linear-gradient(135deg, #7c5cfc15, #7c5cfc05)",
                border: "1px solid #7c5cfc33",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 }}>
                Невыплаченный долг арендаторов
              </div>
              <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "var(--accent2)" }}>
                ${(investorTotalDebt / 1e6).toFixed(2)}
                <span style={{ fontSize: 14, color: "var(--muted)", marginLeft: 8 }}>USDC</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Вы получаете 95% от каждой оплаты
              </div>
            </div>

            {/* Revenue chart (mock until historical data is available) */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
                Дивиденды по месяцам (USDC)
              </div>
              <BarChart data={MOCK_DIVIDENDS} valueKey="amount" labelKey="month" color="#7c5cfc" suffix="" />
            </div>

            {/* Apartments from on-chain */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                Квартиры (On-Chain)
              </div>
              {allApartments.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", padding: "12px 0" }}>
                  Нет зарегистрированных квартир в контракте
                </div>
              )}
              {allApartments.map((apt, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: i < allApartments.length - 1 ? "1px solid var(--border)" : "none",
                    fontSize: 13,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{apt.account.deviceId}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                      Tenant: {apt.account.tenantPubkey.toBase58().slice(0, 4)}...{apt.account.tenantPubkey.toBase58().slice(-4)}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", color: "var(--accent)" }}>
                      {(Number(apt.account.accumulatedPower) / 1e9).toFixed(2)} kWh
                    </div>
                    <div style={{ fontSize: 11, color: "var(--warning)", fontFamily: "'JetBrains Mono', monospace" }}>
                      ${(Number(apt.account.unpaidBalanceUsdc) / 1e6).toFixed(2)} долг
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tenant management */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
                Управление арендаторами
              </div>

              {/* List */}
              {tenants.map((tn, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 13,
                  }}
                >
                  <div>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{tn.wallet}</span>
                    <span style={{ marginLeft: 10, color: "var(--muted)" }}>{tn.apartment}</span>
                  </div>
                  <button
                    onClick={() => handleRemoveTenant(i)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--danger)",
                      background: "transparent",
                      color: "var(--danger)",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    Удалить
                  </button>
                </div>
              ))}

              {/* Add new */}
              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Wallet адрес"
                  value={newTenantWallet}
                  onChange={(e) => setNewTenantWallet(e.target.value)}
                  style={{
                    flex: 2,
                    minWidth: 180,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    outline: "none",
                  }}
                />
                <input
                  type="text"
                  placeholder="Квартира"
                  value={newTenantApt}
                  onChange={(e) => setNewTenantApt(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 100,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleAddTenant}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--accent2)",
                    color: "#0a0b0f",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Добавить
                </button>
              </div>
            </div>

            {/* On-chain info */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
                fontSize: 12,
                color: "var(--muted)",
                lineHeight: 1.7,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
                Информация о контракте
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                <div>Program ID: {PROGRAM_ID.toBase58()}</div>
                {globalConfig && (
                  <>
                    <div>Admin: {globalConfig.admin.toBase58().slice(0, 8)}...{globalConfig.admin.toBase58().slice(-4)}</div>
                    <div>Oracle: {globalConfig.oracle.toBase58().slice(0, 8)}...{globalConfig.oracle.toBase58().slice(-4)}</div>
                    <div>Tariff: {tariffRate} USDC/POWER</div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
