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
  { value: "", label: "Todas las categorías" },
  { value: "Sports", label: "Deportes" },
  { value: "Crypto", label: "Criptomonedas" },
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
  { label: "Cualquiera", value: 0 },
  { label: "$1K+", value: 1000 },
  { label: "$10K+", value: 10000 },
  { label: "$50K+", value: 50000 },
  { label: "$100K+", value: 100000 },
];

const SORT_OPTS: [SortKey, string][] = [
  ["prob", "Probabilidad"],
  ["days", "Tiempo"],
  ["volume", "Volumen"],
  ["gain", "Ganancia"],
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
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { background: #0a0a0f; color: #e8e8f0; }
        select, button { font-family: inherit; }
        select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23888' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px !important; }
        .card:hover { border-color: rgba(99,102,241,0.4) !important; }
        .sort-btn:hover { background: rgba(99,102,241,0.15) !important; }
        .search-btn:hover { background: rgba(99,102,241,0.9) !important; transform: translateY(-1px); }
        .poly-link:hover { background: rgba(99,102,241,0.15) !important; color: #a5b4fc !important; }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "2rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0, background: "linear-gradient(135deg, #a5b4fc, #818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Polymarket Sniper
            </h1>
            {alertCount > 0 && (
              <span onClick={() => setAlertCount(0)} style={{ fontSize: 11, background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 99, padding: "3px 10px", cursor: "pointer", fontWeight: 500 }}>
                +{alertCount} nuevo{alertCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>
            Mercados de alta probabilidad próximos a resolverse
            {fetchedAt && <span style={{ color: "#4b5563" }}> · {new Date(fetchedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>}
          </p>
        </div>
        {searched && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {autoRefresh && <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "'DM Mono', monospace" }}>{fmtCountdown(countdown)}</span>}
            <button onClick={handleAutoRefresh} style={{ fontSize: 12, padding: "6px 14px", border: `1px solid ${autoRefresh ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 99, background: autoRefresh ? "rgba(99,102,241,0.15)" : "transparent", color: autoRefresh ? "#a5b4fc" : "#9ca3af", cursor: "pointer", fontWeight: 500 }}>
              {autoRefresh ? "● Auto ON" : "Auto OFF"}
            </button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 12 }}>
          {[
            { label: "Probabilidad", opts: PROB_OPTS, key: "minProb" as keyof Filters },
            { label: "Cierra en", opts: DAYS_OPTS, key: "maxDays" as keyof Filters },
            { label: "Volumen mín.", opts: VOL_OPTS, key: "minVol" as keyof Filters },
          ].map(({ label, opts, key }) => (
            <div key={key}>
              <label style={{ display: "block", fontSize: 11, color: "#6b7280", marginBottom: 6, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</label>
              <select value={filters[key] as number} onChange={e => setFilters(f => ({ ...f, [key]: parseFloat(e.target.value) }))}
                style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e8f0", fontSize: 13 }}>
                {opts.map(o => <option key={o.value} value={o.value} style={{ background: "#1a1a2e" }}>{o.label}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label style={{ display: "block", fontSize: 11, color: "#6b7280", marginBottom: 6, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>Categoría</label>
            <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
              style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#e8e8f0", fontSize: 13 }}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value} style={{ background: "#1a1a2e" }}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <button onClick={() => fetchMarkets(false)} disabled={loading}
          className="search-btn"
          style={{ width: "100%", padding: "10px", background: loading ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.8)", border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "default" : "pointer", transition: "all 0.15s" }}>
          {loading ? "Buscando mercados..." : "Buscar mercados →"}
        </button>
      </div>

      {error && <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, color: "#f87171", fontSize: 13, marginBottom: "1rem" }}>{error}</div>}

      {/* Métricas */}
      {searched && !loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: "1.5rem" }}>
          {[
            { label: "Mercados", value: String(markets.length) },
            { label: "Prob. media", value: markets.length ? fmtPct(avgProb) : "—" },
            { label: "Volumen total", value: totalVol > 0 ? fmtVol(totalVol) : "—" },
            { label: "Ganancia media", value: markets.length ? ((1 / avgProb - 1) * 100).toFixed(1) + "%" : "—" },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: 22, fontWeight: 600, color: "#e8e8f0", fontFamily: "'DM Mono', monospace" }}>{value}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sort */}
      {sorted.length > 0 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", marginRight: 4 }}>Ordenar</span>
          {SORT_OPTS.map(([key, label]) => (
            <button key={key} onClick={() => setSortKey(key)} className="sort-btn"
              style={{ fontSize: 12, padding: "5px 12px", border: `1px solid ${sortKey === key ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`, borderRadius: 99, background: sortKey === key ? "rgba(99,102,241,0.2)" : "transparent", color: sortKey === key ? "#a5b4fc" : "#9ca3af", cursor: "pointer", fontWeight: sortKey === key ? 600 : 400, transition: "all 0.1s" }}>
              {label}
            </button>
          ))}
          {newIds.size > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "#f87171", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 99, padding: "4px 10px" }}>{newIds.size} nuevo{newIds.size > 1 ? "s" : ""}</span>}
        </div>
      )}

      {/* Lista */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>Consultando Polymarket...</div>}
        {!loading && searched && sorted.length === 0 && <div style={{ textAlign: "center", padding: "3rem", color: "#6b7280" }}>No se encontraron mercados. Prueba a ampliar los filtros.</div>}
        {!loading && sorted.map(m => <MarketCard key={m.id} market={m} isNew={newIds.has(m.id)} />)}
      </div>
    </main>
  );
}

function MarketCard({ market: m, isNew }: { market: ProcessedMarket; isNew: boolean }) {
  const pct = Math.round(m.bestProb * 100);
  const isVH = pct >= 95;
  const probColor = isVH ? "#4ade80" : pct >= 90 ? "#86efac" : "#a3e635";
  const probBg = isVH ? "rgba(74,222,128,0.1)" : "rgba(163,230,53,0.08)";
  const probBorder = isVH ? "rgba(74,222,128,0.3)" : "rgba(163,230,53,0.2)";

  return (
    <div className="card" style={{ background: isNew ? "rgba(99,102,241,0.05)" : "rgba(255,255,255,0.02)", border: `1px solid ${isNew ? "rgba(99,102,241,0.4)" : "rgba(255,255,255,0.07)"}`, borderRadius: 14, padding: "1rem 1.25rem", position: "relative", transition: "border-color 0.15s" }}>
      {isNew && <span style={{ position: "absolute", top: -10, left: 16, fontSize: 10, fontWeight: 600, background: "#6366f1", color: "#fff", borderRadius: 99, padding: "2px 8px", letterSpacing: "0.06em" }}>NUEVO</span>}

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 10 }}>
        {/* Badge prob */}
        <div style={{ flexShrink: 0, width: 58, height: 58, borderRadius: 12, background: probBg, border: `1px solid ${probBorder}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: probColor, fontFamily: "'DM Mono', monospace" }}>{pct}%</span>
          <span style={{ fontSize: 9, color: probColor, opacity: 0.7, fontWeight: 500 }}>{m.bestOutcomeName}</span>
        </div>
        {/* Pregunta */}
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, color: "#d1d5db", lineHeight: 1.5, margin: 0, marginBottom: 4 }}>{m.question}</p>
          {m.oneDayPriceChange !== 0 && (
            <span style={{ fontSize: 11, color: m.oneDayPriceChange > 0 ? "#4ade80" : "#f87171", fontFamily: "'DM Mono', monospace" }}>
              {m.oneDayPriceChange > 0 ? "▲" : "▼"} {Math.abs(m.oneDayPriceChange * 100).toFixed(1)}% hoy
            </span>
          )}
        </div>
      </div>

      {/* Tags */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Tag color="time">⏱ {fmtDays(m.daysLeft)}</Tag>
        <Tag color="vol">⬡ {fmtVol(m.volume)}</Tag>
        {m.volume24hr > 0 && <Tag color="muted">{fmtVol(m.volume24hr)}/24h</Tag>}
        {m.category && <Tag color="cat">{m.category}</Tag>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "#6b7280" }}>
            ganancia: <span style={{ color: "#4ade80", fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>+{fmtGain(m.bestProb)}</span>
          </span>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="poly-link"
            style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", padding: "4px 10px", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 8, transition: "all 0.1s" }}>
            Ver →
          </a>
        </div>
      </div>

      {m.bestBid > 0 && m.bestAsk > 0 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 11, color: "#4b5563", fontFamily: "'DM Mono', monospace" }}>
          bid {fmtPct(m.bestBid)} · ask {fmtPct(m.bestAsk)} · spread {(m.spread * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function Tag({ children, color }: { children: React.ReactNode; color: "time" | "vol" | "muted" | "cat" }) {
  const styles: Record<string, React.CSSProperties> = {
    time: { background: "rgba(251,146,60,0.1)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.2)" },
    vol:  { background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" },
    muted:{ background: "rgba(255,255,255,0.04)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.07)" },
    cat:  { background: "rgba(255,255,255,0.04)", color: "#9ca3af", border: "1px solid rgba(255,255,255,0.07)" },
  };
  return (
    <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 99, fontWeight: 500, ...styles[color] }}>{children}</span>
  );
}
