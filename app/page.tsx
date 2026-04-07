"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ProcessedMarket } from "./api/markets/route";

const REFRESH_SEC = 300;

function fmtVol(v: number) {
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return "$" + Math.round(v / 1_000) + "K";
  return "$" + Math.round(v);
}
function fmtDays(d: number) {
  if (d < 0) return "resolviendo";
  if (d < 1 / 24) return "< 1h";
  if (d < 1) return Math.round(d * 24) + "h";
  return d.toFixed(1) + "d";
}
function fmtGain(p: number) { return ((1 / p - 1) * 100).toFixed(1) + "%"; }
function fmtPct(p: number) { return Math.round(p * 100) + "%"; }
function fmtCountdown(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

type SortKey = "prob" | "days" | "volume" | "gain";

interface Filters { minProb: number; maxDays: number; minVol: number; category: string; }

const CATEGORIES = [
  { value: "", label: "Todas" },
  { value: "Sports", label: "Deportes" },
  { value: "Crypto", label: "Cripto" },
  { value: "Politics", label: "Política" },
  { value: "Weather", label: "Clima" },
  { value: "Finance", label: "Finanzas" },
  { value: "Entertainment", label: "Entretenimiento" },
  { value: "Science", label: "Ciencia" },
  { value: "Technology", label: "Tecnología" },
  { value: "World", label: "Internacional" },
  { value: "Business", label: "Negocios" },
];

const PROB_OPTS = [
  { label: "80%+", value: 0.80 },
  { label: "85%+", value: 0.85 },
  { label: "90%+", value: 0.90 },
  { label: "93%+", value: 0.93 },
  { label: "95%+", value: 0.95 },
  { label: "97%+", value: 0.97 },
];

const DAYS_OPTS = [
  { label: "≤ 12h", value: 0.5 },
  { label: "≤ 1 día", value: 1 },
  { label: "≤ 2 días", value: 2 },
  { label: "≤ 3 días", value: 3 },
  { label: "≤ 7 días", value: 7 },
  { label: "≤ 14 días", value: 14 },
  { label: "≤ 30 días", value: 30 },
];

const VOL_OPTS = [
  { label: "Cualquiera", value: 0, sort: "prob" as SortKey },
  { label: "$1K+", value: 1000, sort: "volume" as SortKey },
  { label: "$10K+", value: 10000, sort: "volume" as SortKey },
  { label: "$50K+", value: 50000, sort: "volume" as SortKey },
  { label: "$100K+", value: 100000, sort: "volume" as SortKey },
];

export default function Home() {
  const [filters, setFilters] = useState<Filters>({ minProb: 0.9, maxDays: 7, minVol: 1000, category: "" });
  const [markets, setMarkets] = useState<ProcessedMarket[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("prob");
  const [searched, setSearched] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [alertCount, setAlertCount] = useState(0);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const fetchMarkets = useCallback(async (isAuto = false) => {
    setLoading(true); setError(null);
    const f = filtersRef.current;
    try {
      const qs = new URLSearchParams({
        minProb: String(f.minProb), maxDays: String(f.maxDays),
        minVol: String(f.minVol), category: f.category,
        ...(isAuto ? { t: String(Date.now()) } : {}),
      });
      const res = await fetch(`/api/markets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      const incoming: ProcessedMarket[] = data.markets;
      const incomingIds = new Set(incoming.map(m => m.id));
      if (isAuto && prevIdsRef.current.size > 0) {
        const detected = new Set(incoming.filter(m => !prevIdsRef.current.has(m.id)).map(m => m.id));
        setNewIds(detected);
        if (detected.size > 0) {
          setAlertCount(c => c + detected.size);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("Polymarket Sniper", { body: `${detected.size} nuevo${detected.size > 1 ? "s" : ""} mercado${detected.size > 1 ? "s" : ""}` });
          }
        } else setNewIds(new Set());
      } else setNewIds(new Set());
      prevIdsRef.current = incomingIds;
      setMarkets(incoming);
      setFetchedAt(data.fetchedAt);
      setSearched(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!autoRefresh || !searched) return;
    setCountdown(REFRESH_SEC);
    const tick = setInterval(() => {
      setCountdown(c => { if (c <= 1) { fetchMarkets(true); return REFRESH_SEC; } return c - 1; });
    }, 1000);
    return () => clearInterval(tick);
  }, [autoRefresh, searched, fetchMarkets]);

  const handleAutoRefresh = () => {
    const next = !autoRefresh; setAutoRefresh(next);
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission();
  };

  // Cambio de volumen → ordenar por volumen automáticamente
  const handleVolChange = (val: number) => {
    const opt = VOL_OPTS.find(o => o.value === val);
    setFilters(f => ({ ...f, minVol: val }));
    if (opt) setSortKey(opt.sort);
  };

  // Cambio de probabilidad → ordenar por probabilidad
  const handleProbChange = (val: number) => {
    setFilters(f => ({ ...f, minProb: val }));
    setSortKey("prob");
  };

  // Cambio de días → ordenar por tiempo restante
  const handleDaysChange = (val: number) => {
    setFilters(f => ({ ...f, maxDays: val }));
    setSortKey("days");
  };

  const sorted = [...markets].sort((a, b) => {
    if (sortKey === "prob") return b.bestProb - a.bestProb;
    if (sortKey === "days") return a.daysLeft - b.daysLeft;
    if (sortKey === "volume") return b.volume - a.volume;
    if (sortKey === "gain") return 1 / a.bestProb - 1 / b.bestProb;
    return 0;
  });

  const avgProb = markets.length ? markets.reduce((s, m) => s + m.bestProb, 0) / markets.length : 0;
  const totalVol = markets.reduce((s, m) => s + m.volume, 0);

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: "2.5rem 1.5rem", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #07070e; color: #e2e2ee; }
        select, button, input { font-family: inherit; }
        select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23555' d='M5 7L0 2h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          padding-right: 28px !important;
          cursor: pointer;
        }
        select:focus { outline: none; border-color: rgba(129,140,248,0.5) !important; }
        .mcard { transition: border-color 0.2s, transform 0.1s; }
        .mcard:hover { border-color: rgba(129,140,248,0.35) !important; transform: translateY(-1px); }
        .sort-pill { transition: all 0.15s; cursor: pointer; }
        .sort-pill:hover { border-color: rgba(129,140,248,0.4) !important; color: #a5b4fc !important; }
        .search-btn { transition: all 0.15s; }
        .search-btn:hover:not(:disabled) { background: rgba(99,102,241,0.95) !important; box-shadow: 0 0 24px rgba(99,102,241,0.3); }
        .poly-link { transition: all 0.12s; }
        .poly-link:hover { background: rgba(129,140,248,0.15) !important; color: #c7d2fe !important; border-color: rgba(129,140,248,0.4) !important; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ marginBottom: "2.5rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            {/* Logo / Título */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                ◎
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", background: "linear-gradient(135deg, #c7d2fe 0%, #a5b4fc 50%, #818cf8 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Polymarket Sniper
              </h1>
              {alertCount > 0 && (
                <span onClick={() => setAlertCount(0)}
                  style={{ fontSize: 11, background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 99, padding: "3px 10px", cursor: "pointer", fontWeight: 600, letterSpacing: "0.02em" }}>
                  +{alertCount} nuevo{alertCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p style={{ fontSize: 14, color: "#4b5563", lineHeight: 1.5 }}>
              Detecta mercados de alta probabilidad próximos a resolverse.
              {fetchedAt && (
                <span style={{ color: "#374151" }}>
                  {" "}Actualizado a las {new Date(fetchedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </p>
          </div>

          {/* Auto-refresh */}
          {searched && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
              {autoRefresh && (
                <span style={{ fontSize: 12, color: "#374151", fontFamily: "'DM Mono', monospace", letterSpacing: "0.04em" }}>
                  {fmtCountdown(countdown)}
                </span>
              )}
              <button onClick={handleAutoRefresh} style={{
                fontSize: 12, padding: "7px 16px",
                border: `1px solid ${autoRefresh ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 99,
                background: autoRefresh ? "rgba(99,102,241,0.12)" : "transparent",
                color: autoRefresh ? "#a5b4fc" : "#6b7280",
                cursor: "pointer", fontWeight: 500,
              }}>
                {autoRefresh ? "● Auto-refresh ON" : "Auto-refresh OFF"}
              </button>
            </div>
          )}
        </div>

        {/* Separador */}
        <div style={{ marginTop: "1.5rem", height: 1, background: "linear-gradient(90deg, rgba(99,102,241,0.3) 0%, rgba(99,102,241,0.05) 60%, transparent 100%)" }} />
      </header>

      {/* ── FILTROS ── */}
      <section style={{ marginBottom: "1.75rem" }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 14, marginBottom: 16 }}>
            {/* Probabilidad */}
            <FilterGroup label="Probabilidad mínima" active={sortKey === "prob"}>
              <select value={filters.minProb} onChange={e => handleProbChange(parseFloat(e.target.value))}
                style={selectStyle}>
                {PROB_OPTS.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
              </select>
            </FilterGroup>

            {/* Cierre */}
            <FilterGroup label="Cierra en" active={sortKey === "days"}>
              <select value={filters.maxDays} onChange={e => handleDaysChange(parseFloat(e.target.value))}
                style={selectStyle}>
                {DAYS_OPTS.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
              </select>
            </FilterGroup>

            {/* Volumen */}
            <FilterGroup label="Volumen mínimo" active={sortKey === "volume"}>
              <select value={filters.minVol} onChange={e => handleVolChange(parseFloat(e.target.value))}
                style={selectStyle}>
                {VOL_OPTS.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
              </select>
            </FilterGroup>

            {/* Categoría */}
            <FilterGroup label="Categoría" active={false}>
              <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                style={selectStyle}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value} style={{ background: "#111" }}>{c.label}</option>)}
              </select>
            </FilterGroup>
          </div>

          <button onClick={() => fetchMarkets(false)} disabled={loading} className="search-btn"
            style={{ width: "100%", padding: "12px", background: loading ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.75)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 12, color: "#fff", fontSize: 15, fontWeight: 600, cursor: loading ? "default" : "pointer", letterSpacing: "0.01em" }}>
            {loading ? "Buscando mercados..." : "Buscar mercados →"}
          </button>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, color: "#fca5a5", fontSize: 13, marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      {/* ── MÉTRICAS ── */}
      {searched && !loading && (
        <section style={{ marginBottom: "1.75rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {[
              { label: "Mercados encontrados", value: String(markets.length), accent: false },
              { label: "Probabilidad media", value: markets.length ? fmtPct(avgProb) : "—", accent: true },
              { label: "Volumen total", value: totalVol > 0 ? fmtVol(totalVol) : "—", accent: false },
              { label: "Ganancia media", value: markets.length ? ((1 / avgProb - 1) * 100).toFixed(1) + "%" : "—", accent: true },
            ].map(({ label, value, accent }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "16px 18px" }}>
                <div style={{ fontSize: 24, fontWeight: 600, color: accent ? "#a5b4fc" : "#e2e2ee", fontFamily: "'DM Mono', monospace", letterSpacing: "-0.02em" }}>{value}</div>
                <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── SORT BAR ── */}
      {sorted.length > 0 && (
        <section style={{ marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600, marginRight: 4 }}>Ordenar por</span>
            {([
              ["prob", "Probabilidad ↓"],
              ["days", "Tiempo restante ↑"],
              ["volume", "Volumen ↓"],
              ["gain", "Ganancia ↓"],
            ] as [SortKey, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setSortKey(key)} className="sort-pill"
                style={{ fontSize: 12, padding: "5px 14px", border: `1px solid ${sortKey === key ? "rgba(129,140,248,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: 99, background: sortKey === key ? "rgba(99,102,241,0.18)" : "transparent", color: sortKey === key ? "#a5b4fc" : "#6b7280", fontWeight: sortKey === key ? 600 : 400 }}>
                {label}
              </button>
            ))}
            {newIds.size > 0 && (
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#fca5a5", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 99, padding: "4px 12px", fontWeight: 500 }}>
                {newIds.size} nuevo{newIds.size > 1 ? "s" : ""} en este refresh
              </span>
            )}
          </div>
          <div style={{ marginTop: "0.75rem", height: 1, background: "rgba(255,255,255,0.04)" }} />
        </section>
      )}

      {/* ── LISTA ── */}
      <section>
        {loading && (
          <div style={{ textAlign: "center", padding: "4rem 0", color: "#374151" }}>
            <div style={{ fontSize: 14 }}>Consultando Polymarket API...</div>
          </div>
        )}
        {!loading && searched && sorted.length === 0 && (
          <div style={{ textAlign: "center", padding: "4rem 0", color: "#374151" }}>
            <div style={{ fontSize: 15, marginBottom: 8 }}>Sin resultados</div>
            <div style={{ fontSize: 13 }}>Prueba a ampliar los filtros de probabilidad, días o volumen.</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!loading && sorted.map((m, i) => <MarketCard key={m.id} market={m} isNew={newIds.has(m.id)} rank={i + 1} />)}
        </div>
      </section>

      {/* Footer */}
      {sorted.length > 0 && (
        <footer style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.04)", textAlign: "center" }}>
          <span style={{ fontSize: 12, color: "#1f2937" }}>Polymarket Sniper · Datos en tiempo real via Gamma API · {sorted.length} mercados</span>
        </footer>
      )}
    </main>
  );
}

// ── Estilos reutilizables ────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "9px 10px",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10, color: "#d1d5db", fontSize: 13,
};

function FilterGroup({ label, children, active }: { label: string; children: React.ReactNode; active: boolean }) {
  return (
    <div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: active ? "#818cf8" : "#4b5563", marginBottom: 7, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {active && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#818cf8", display: "inline-block", flexShrink: 0 }} />}
        {label}
      </label>
      {children}
    </div>
  );
}

function MarketCard({ market: m, isNew, rank }: { market: ProcessedMarket; isNew: boolean; rank: number }) {
  const pct = Math.round(m.bestProb * 100);
  const isVH = pct >= 95;
  const isH = pct >= 90;
  const probColor = isVH ? "#4ade80" : isH ? "#86efac" : "#bef264";
  const probBg = isVH ? "rgba(74,222,128,0.08)" : "rgba(190,242,100,0.06)";
  const probBorder = isVH ? "rgba(74,222,128,0.25)" : "rgba(190,242,100,0.15)";
  const gain = ((1 / m.bestProb - 1) * 100).toFixed(1);

  return (
    <div className="mcard" style={{
      background: isNew ? "rgba(99,102,241,0.04)" : "rgba(255,255,255,0.015)",
      border: `1px solid ${isNew ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.06)"}`,
      borderRadius: 16, padding: "1.1rem 1.25rem", position: "relative",
    }}>
      {isNew && (
        <span style={{ position: "absolute", top: -10, left: 18, fontSize: 10, fontWeight: 700, background: "#6366f1", color: "#fff", borderRadius: 99, padding: "2px 9px", letterSpacing: "0.08em" }}>
          NUEVO
        </span>
      )}

      {/* Número de ranking sutil */}
      <span style={{ position: "absolute", top: 14, right: 16, fontSize: 11, color: "#1f2937", fontFamily: "'DM Mono', monospace" }}>#{rank}</span>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 12 }}>
        {/* Badge probabilidad */}
        <div style={{ flexShrink: 0, width: 62, height: 62, borderRadius: 14, background: probBg, border: `1px solid ${probBorder}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: probColor, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{pct}%</span>
          <span style={{ fontSize: 9, color: probColor, opacity: 0.65, fontWeight: 600, letterSpacing: "0.04em" }}>{m.bestOutcomeName.toUpperCase()}</span>
        </div>

        {/* Pregunta + variación */}
        <div style={{ flex: 1, paddingRight: 24 }}>
          <p style={{ fontSize: 14, color: "#c9cad6", lineHeight: 1.55, marginBottom: 6, fontWeight: 400 }}>{m.question}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {m.oneDayPriceChange !== 0 && (
              <span style={{ fontSize: 11, color: m.oneDayPriceChange > 0 ? "#4ade80" : "#f87171", fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>
                {m.oneDayPriceChange > 0 ? "▲" : "▼"} {Math.abs(m.oneDayPriceChange * 100).toFixed(1)}% hoy
              </span>
            )}
            {m.category && (
              <span style={{ fontSize: 11, color: "#374151", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "2px 8px" }}>
                {m.category}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Separador interno */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.04)", marginBottom: 10 }} />

      {/* Stats row */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Chip icon="⏱" label={fmtDays(m.daysLeft)} color="orange" />
        <Chip icon="◈" label={fmtVol(m.volume)} color="indigo" />
        {m.volume24hr > 0 && <Chip icon="" label={`${fmtVol(m.volume24hr)}/24h`} color="muted" />}

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "#374151", letterSpacing: "0.02em" }}>ganancia potencial</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#4ade80", fontFamily: "'DM Mono', monospace", lineHeight: 1.2 }}>+{gain}%</div>
          </div>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="poly-link"
            style={{ fontSize: 12, color: "#818cf8", textDecoration: "none", padding: "7px 14px", border: "1px solid rgba(129,140,248,0.25)", borderRadius: 10, fontWeight: 500, whiteSpace: "nowrap" }}>
            Ver →
          </a>
        </div>
      </div>

      {/* Spread */}
      {m.bestBid > 0 && m.bestAsk > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#1f2937", fontFamily: "'DM Mono', monospace" }}>
          bid {fmtPct(m.bestBid)} · ask {fmtPct(m.bestAsk)} · spread {(m.spread * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function Chip({ icon, label, color }: { icon: string; label: string; color: "orange" | "indigo" | "muted" }) {
  const s: Record<string, React.CSSProperties> = {
    orange: { background: "rgba(251,146,60,0.08)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.18)" },
    indigo: { background: "rgba(99,102,241,0.08)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.18)" },
    muted:  { background: "rgba(255,255,255,0.03)", color: "#374151", border: "1px solid rgba(255,255,255,0.05)" },
  };
  return (
    <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4, ...s[color] }}>
      {icon && <span style={{ fontSize: 10 }}>{icon}</span>}{label}
    </span>
  );
}
