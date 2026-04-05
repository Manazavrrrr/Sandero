import { useState, useEffect, useCallback } from "react";

const MOCK_DATA = {
  tenant: {
    apartment: "APT-42-7F",
    building: "SolVilla Residence",
    address: "ул. Блокчейн, 42",
    currentMonth: "Апрель 2026",
    consumed: 147.3,
    rate: 0.10,
    debt: 14.73,
    paid: false,
    history: [
      { month: "Ноя", kwh: 132, cost: 13.2 },
      { month: "Дек", kwh: 158, cost: 15.8 },
      { month: "Янв", kwh: 175, cost: 17.5 },
      { month: "Фев", kwh: 141, cost: 14.1 },
      { month: "Мар", kwh: 129, cost: 12.9 },
      { month: "Апр", kwh: 147, cost: 14.7 },
    ],
  },
  investor: {
    tokens: 150,
    totalTokens: 1000,
    share: 15,
    building: "SolVilla Residence",
    address: "ул. Блокчейн, 42",
    totalRevenue: 847.50,
    myRevenue: 127.13,
    occupancy: 87,
    totalPower: 12450,
    dividends: [
      { month: "Ноя", amount: 18.4 },
      { month: "Дек", amount: 22.1 },
      { month: "Янв", amount: 24.8 },
      { month: "Фев", amount: 19.6 },
      { month: "Мар", amount: 21.3 },
      { month: "Апр", amount: 20.9 },
    ],
  },
};

// Mini chart component
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

export default function PropChainDashboard() {
  const [role, setRole] = useState("tenant");
  const [wallet, setWallet] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [paymentDone, setPaymentDone] = useState(false);
  const [liveKwh, setLiveKwh] = useState(MOCK_DATA.tenant.consumed);

  // Simulate live meter
  useEffect(() => {
    const iv = setInterval(() => {
      setLiveKwh((prev) => +(prev + Math.random() * 0.03).toFixed(2));
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  const connectWallet = useCallback(async () => {
    setConnecting(true);
    // Check for Phantom
    if (window.solana && window.solana.isPhantom) {
      try {
        const resp = await window.solana.connect();
        setWallet(resp.publicKey.toString());
      } catch (e) {
        console.error(e);
      }
    } else {
      // Mock wallet for demo
      await new Promise((r) => setTimeout(r, 1200));
      setWallet("7xK9...dF3q");
    }
    setConnecting(false);
  }, []);

  const disconnectWallet = () => {
    if (window.solana && window.solana.isPhantom) {
      window.solana.disconnect();
    }
    setWallet(null);
    setPaymentDone(false);
  };

  const handlePay = async () => {
    // In real app: call smart contract to burn $POWER and transfer USDC
    setPaymentDone(true);
  };

  const t = MOCK_DATA.tenant;
  const inv = MOCK_DATA.investor;
  const shortWallet = wallet ? (wallet.length > 12 ? wallet.slice(0, 4) + "..." + wallet.slice(-4) : wallet) : null;

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

        {/* Role toggle */}
        <div
          style={{
            display: "flex",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 3,
          }}
        >
          {[
            { id: "tenant", label: "Арендатор" },
            { id: "investor", label: "Инвестор" },
          ].map((r) => (
            <button
              key={r.id}
              onClick={() => setRole(r.id)}
              style={{
                padding: "8px 18px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif",
                background: role === r.id ? (r.id === "tenant" ? "var(--accent)" : "var(--accent2)") : "transparent",
                color: role === r.id ? "#0a0b0f" : "var(--muted)",
                transition: "all 0.25s ease",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Wallet */}
        {wallet ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <PulsingDot color="var(--accent)" />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13 }}>{shortWallet}</span>
            <button
              onClick={disconnectWallet}
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
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            disabled={connecting}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, #7c5cfc, #ab47bc)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              cursor: connecting ? "wait" : "pointer",
              fontFamily: "'DM Sans', sans-serif",
              opacity: connecting ? 0.7 : 1,
              transition: "opacity 0.2s",
            }}
          >
            {connecting ? "Подключение..." : "🔮 Phantom Wallet"}
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ maxWidth: 720, margin: "0 auto", animation: "fadeUp 0.5s ease" }} key={role}>
        {role === "tenant" ? (
          /* ===== TENANT VIEW ===== */
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Title */}
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                Мой Дом
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{t.building}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                {t.address} · Квартира {t.apartment}
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
                    Счётчик · Live
                  </span>
                </div>
                <div style={{ fontSize: 38, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "var(--accent)" }}>
                  {liveKwh.toFixed(1)}
                  <span style={{ fontSize: 16, color: "var(--muted)", marginLeft: 6 }}>кВт·ч</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  = {liveKwh.toFixed(1)} $POWER токенов · {t.currentMonth}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>К ОПЛАТЕ</div>
                <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: paymentDone ? "var(--accent)" : "var(--warning)" }}>
                  {paymentDone ? "✓" : `$${(liveKwh * t.rate).toFixed(2)}`}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{paymentDone ? "Оплачено" : "USDC"}</div>
              </div>
            </div>

            {/* Pay button */}
            {wallet && !paymentDone && (
              <button
                onClick={handlePay}
                style={{
                  width: "100%",
                  padding: "16px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #00e5a0, #00c48c)",
                  color: "#0a0b0f",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = "translateY(-1px)";
                  e.target.style.boxShadow = "0 6px 24px #00e5a044";
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = "translateY(0)";
                  e.target.style.boxShadow = "none";
                }}
              >
                ⚡ Оплатить {(liveKwh * t.rate).toFixed(2)} USDC → Сжечь {liveKwh.toFixed(0)} $POWER
              </button>
            )}

            {!wallet && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: "1px dashed var(--border)",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                Подключите Phantom Wallet для оплаты
              </div>
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
                ✓ Транзакция подтверждена · {liveKwh.toFixed(0)} $POWER сожжено · {(liveKwh * t.rate).toFixed(2)} USDC списано
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
              <BarChart data={t.history} valueKey="kwh" labelKey="month" color="#00e5a0" suffix="" />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                <span>Ср: {(t.history.reduce((a, b) => a + b.kwh, 0) / t.history.length).toFixed(0)} кВт·ч</span>
                <span>Итого: ${t.history.reduce((a, b) => a + b.cost, 0).toFixed(1)} USDC</span>
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
                <div>⚡ Счётчик фиксирует потребление → 1 кВт·ч = 1 $POWER токен</div>
                <div>💰 Вы оплачиваете USDC → контракт сжигает $POWER</div>
                <div>📊 Каждый кВт·ч виден в Solscan — полная прозрачность</div>
              </div>
            </div>
          </div>
        ) : (
          /* ===== INVESTOR VIEW ===== */
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Title */}
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1.5, fontFamily: "'JetBrains Mono', monospace", marginBottom: 4 }}>
                Мои Инвестиции
              </div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{inv.building}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{inv.address}</div>
            </div>

            {/* Stats row */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <StatCard label="Моя доля" value={`${inv.tokens}`} sub={`$PROP · ${inv.share}% объекта`} accent="var(--accent2)" />
              <StatCard label="Мой доход" value={`$${inv.myRevenue}`} sub="USDC за всё время" accent="var(--accent)" />
              <StatCard label="Загрузка" value={`${inv.occupancy}%`} sub="квартир арендовано" accent="var(--warning)" />
            </div>

            {/* Revenue share visual */}
            <div
              style={{
                background: "linear-gradient(135deg, #7c5cfc22, #7c5cfc08)",
                border: "1px solid #7c5cfc33",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Распределение дохода</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, height: 28, borderRadius: 8, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${inv.share}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #7c5cfc, #ab47bc)",
                    borderRadius: "8px 0 0 8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {inv.share}%
                </div>
                <div
                  style={{
                    flex: 1,
                    height: "100%",
                    background: "var(--border)",
                    borderRadius: "0 8px 8px 0",
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: 10,
                    fontSize: 11,
                    color: "var(--muted)",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  остальные держатели
                </div>
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--muted)" }}>
                {inv.tokens} из {inv.totalTokens} $PROP · Общий доход ЖК: ${inv.totalRevenue} USDC
              </div>
            </div>

            {/* Dividends chart */}
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
              <BarChart data={inv.dividends} valueKey="amount" labelKey="month" color="#7c5cfc" suffix="$" />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                <span>Ср: ${(inv.dividends.reduce((a, b) => a + b.amount, 0) / inv.dividends.length).toFixed(1)}/мес</span>
                <span>Итого: ${inv.dividends.reduce((a, b) => a + b.amount, 0).toFixed(1)} USDC</span>
              </div>
            </div>

            {/* Live network load */}
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <PulsingDot color="var(--warning)" />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Загрузка сети · Live</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "var(--warning)" }}>
                {(inv.totalPower + Math.floor(Math.random() * 50)).toLocaleString()}
                <span style={{ fontSize: 14, color: "var(--muted)", marginLeft: 6 }}>$POWER / мес</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Суммарное потребление всех квартир из блокчейна
              </div>
            </div>

            {/* Sell button */}
            {wallet ? (
              <button
                style={{
                  width: "100%",
                  padding: "16px",
                  borderRadius: 12,
                  border: "1px solid #7c5cfc55",
                  background: "transparent",
                  color: "var(--accent2)",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = "#7c5cfc22";
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = "transparent";
                }}
              >
                🏪 Продать доли на маркетплейсе
              </button>
            ) : (
              <div
                style={{
                  padding: 16,
                  borderRadius: 12,
                  border: "1px dashed var(--border)",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: 13,
                }}
              >
                Подключите Phantom Wallet для торговли $PROP
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 32,
            paddingTop: 16,
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "var(--muted)",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          <span>PropChain MVP · Solana Devnet</span>
          <span>$PROP · $POWER · USDC</span>
        </div>
      </div>
    </div>
  );
}