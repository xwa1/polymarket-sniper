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
function fmtPct(p: number) { return Math.round(p * 100) + "%"; }
function fmtCountdown(s: number) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

type SortKey = "prob" | "days" | "volume" | "gain";
type SortDir = "asc" | "desc";
interface Filters { minProb: number; maxDays: number; minVol: number; category: string; }

const CATEGORIES = [
  { value: "", label: "Todas" }, { value: "Sports", label: "Deportes" },
  { value: "Crypto", label: "Cripto" }, { value: "Politics", label: "Política" },
  { value: "Weather", label: "Clima" }, { value: "Finance", label: "Finanzas" },
  { value: "Entertainment", label: "Entretenimiento" },
  { value: "Technology", label: "Tecnología" }, { value: "World", label: "Internacional" },
];
const PROB_OPTS = [
  { label: "80%+", value: 0.80 }, { label: "85%+", value: 0.85 },
  { label: "90%+", value: 0.90 }, { label: "93%+", value: 0.93 },
  { label: "95%+", value: 0.95 }, { label: "97%+", value: 0.97 },
];
const DAYS_OPTS = [
  { label: "≤ 12h", value: 0.5 }, { label: "≤ 1 día", value: 1 },
  { label: "≤ 2 días", value: 2 }, { label: "≤ 3 días", value: 3 },
  { label: "≤ 7 días", value: 7 }, { label: "≤ 14 días", value: 14 },
  { label: "≤ 30 días", value: 30 },
];
const VOL_OPTS = [
  { label: "Cualquiera", value: 0 }, { label: "$1K+", value: 1000 },
  { label: "$10K+", value: 10000 }, { label: "$50K+", value: 50000 },
  { label: "$100K+", value: 100000 },
];

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ change, prob }: { change: number; prob: number }) {
  const w = 72, h = 28;
  const end = Math.max(0.01, Math.min(0.99, prob));
  const start = Math.max(0.01, Math.min(0.99, prob - change));
  const pts = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    return start + (end - start) * t + Math.sin(i * 2.1 + prob * 8) * 0.012;
  });
  const min = Math.min(...pts) - 0.015;
  const max = Math.max(...pts) + 0.015;
  const range = max - min || 0.1;
  const coords = pts.map((v, i) => `${(i / 9) * w},${h - ((v - min) / range) * h}`).join(" ");
  const color = change >= 0 ? "#4ade80" : "#f87171";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible", display: "block" }}>
      <polyline points={coords} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      <polyline points={`${coords} ${w},${h} 0,${h}`} fill={color} opacity="0.07" />
    </svg>
  );
}

// ── News terminal ─────────────────────────────────────────────────────────────
function NewsTerminal() {
  const [items, setItems] = useState<{ title: string; source: string; time: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/news?per_page=20")
      .then(r => r.json())
      .then(data => {
        setItems((data.data ?? []).slice(0, 20).map((n: any) => ({
          title: n.title ?? "",
          source: n.news_site ?? "CoinGecko",
          time: n.updated_at ? new Date(n.updated_at * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "",
          url: n.url ?? "#",
        })));
      })
      .catch(() => setItems([
        { title: "Bitcoin cae por debajo de $75K en medio de tensiones arancelarias", source: "CoinDesk", time: "10:32", url: "#" },
        { title: "Ethereum mantiene soporte en $1,500 tras corrección del mercado", source: "CryptoNews", time: "10:18", url: "#" },
        { title: "Fed mantiene tasas — mercados de predicción reaccionan", source: "Yahoo Finance", time: "09:55", url: "#" },
        { title: "Trump impone nuevos aranceles: impacto en mercados crypto", source: "Reuters", time: "09:30", url: "#" },
        { title: "Solana supera 50M de transacciones diarias", source: "The Block", time: "09:12", url: "#" },
        { title: "SEC revisa regulación de stablecoins para Q2 2026", source: "Bloomberg", time: "08:47", url: "#" },
        { title: "MicroStrategy añade 1,200 BTC a su balance", source: "CoinTelegraph", time: "08:20", url: "#" },
      ]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {loading ? <div style={{ color: "#4b5563", fontSize: 12 }}>Cargando noticias...</div> : items.map((n, i) => (
        <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
          style={{ display: "block", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", textDecoration: "none" }}>
          <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.45, marginBottom: 3 }}>{n.title}</div>
          <div style={{ fontSize: 10, color: "#4b5563" }}>{n.source} · {n.time}</div>
        </a>
      ))}
    </div>
  );
}

// ── Urgent markets terminal ───────────────────────────────────────────────────
function UrgentTerminal({ markets }: { markets: ProcessedMarket[] }) {
  const urgent = [...markets].filter(m => m.daysLeft >= 0 && m.daysLeft <= 3).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 15);
  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {urgent.length === 0
        ? <div style={{ color: "#4b5563", fontSize: 12 }}>Busca mercados para ver los que cierran pronto.</div>
        : urgent.map((m, i) => {
          const pct = Math.round(m.bestProb * 100);
          const c = pct >= 95 ? "#4ade80" : pct >= 90 ? "#86efac" : "#facc15";
          return (
            <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", textDecoration: "none" }}>
              <span style={{ fontSize: 10, color: "#374151", minWidth: 16, fontFamily: "monospace" }}>{i + 1}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: c, minWidth: 42, fontFamily: "monospace" }}>{pct}%</span>
              <span style={{ fontSize: 11, color: "#6b7280", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</span>
              <span style={{ fontSize: 10, color: "#f97316", fontFamily: "monospace" }}>{fmtDays(m.daysLeft)}</span>
            </a>
          );
        })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [filters, setFilters] = useState<Filters>({ minProb: 0.9, maxDays: 7, minVol: 1000, category: "" });
  const [markets, setMarkets] = useState<ProcessedMarket[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("prob");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [alertCount, setAlertCount] = useState(0);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Carga inicial con parámetros por defecto
  useEffect(() => { doFetch(false); }, []);

  const doFetch = useCallback(async (isAuto: boolean) => {
    setLoading(true);
    setError(null);
    const f = filtersRef.current;
    try {
      const qs = new URLSearchParams({
        minProb: String(f.minProb),
        maxDays: String(f.maxDays),
        minVol: String(f.minVol),
        category: f.category,
        ...(isAuto ? { t: String(Date.now()) } : {}),
      });
      const res = await fetch(`/api/markets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error de API");
      const incoming: ProcessedMarket[] = data.markets ?? [];
      const incomingIds = new Set(incoming.map((m) => m.id));
      if (isAuto && prevIdsRef.current.size > 0) {
        const detected = new Set(incoming.filter((m) => !prevIdsRef.current.has(m.id)).map((m) => m.id));
        setNewIds(detected);
        if (detected.size > 0) {
          setAlertCount((c) => c + detected.size);
          if (typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification("PolyEdge", { body: `${detected.size} nuevo${detected.size > 1 ? "s" : ""} mercado${detected.size > 1 ? "s" : ""}` });
        } else setNewIds(new Set());
      } else setNewIds(new Set());
      prevIdsRef.current = incomingIds;
      setMarkets(incoming);
      setFetchedAt(data.fetchedAt);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    setCountdown(REFRESH_SEC);
    const tick = setInterval(() => {
      setCountdown((c) => { if (c <= 1) { doFetch(true); return REFRESH_SEC; } return c - 1; });
    }, 1000);
    return () => clearInterval(tick);
  }, [autoRefresh, doFetch]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const sorted = [...markets].sort((a, b) => {
    let diff = 0;
    if (sortKey === "prob") diff = b.bestProb - a.bestProb;
    else if (sortKey === "days") diff = a.daysLeft - b.daysLeft;
    else if (sortKey === "volume") diff = b.volume - a.volume;
    else if (sortKey === "gain") diff = 1 / a.bestProb - 1 / b.bestProb;
    return sortDir === "asc" ? -diff : diff;
  });

  const avgProb = markets.length ? markets.reduce((s, m) => s + m.bestProb, 0) / markets.length : 0;
  const totalVol = markets.reduce((s, m) => s + m.volume, 0);

  const sortLabel = (key: SortKey) => {
    const labels: Record<SortKey, string> = { prob: "Prob.", days: "Tiempo", volume: "Volumen", gain: "Ganancia" };
    return labels[key] + (sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "");
  };

  return (
    <main style={{ maxWidth: 1060, margin: "0 auto", padding: "2rem 1.5rem", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#07070e;color:#e2e2ee;}
        select,button{font-family:inherit;}
        select{appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23555' d='M5 6L0 0h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;padding-right:28px!important;}
        select:focus{outline:none;}
        .mcard{transition:border-color 0.18s,transform 0.12s;}
        .mcard:hover{border-color:rgba(129,140,248,0.35)!important;transform:translateY(-1px);}
        .sbtn{transition:all 0.12s;cursor:pointer;}
        .sbtn:hover{color:#a5b4fc!important;border-color:rgba(129,140,248,0.4)!important;}
        .srchbtn{transition:all 0.14s;}
        .srchbtn:hover:not(:disabled){background:rgba(99,102,241,1)!important;box-shadow:0 0 18px rgba(99,102,241,0.4);}
        .pl{transition:all 0.12s;}
        .pl:hover{background:rgba(129,140,248,0.12)!important;color:#c7d2fe!important;border-color:rgba(129,140,248,0.4)!important;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ marginBottom: "1.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>◎</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.025em", background: "linear-gradient(135deg,#c7d2fe,#a5b4fc,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>PolyEdge</h1>
            <span style={{ fontSize: 10, color: "#374151", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5, padding: "2px 7px", fontWeight: 600 }}>BETA</span>
            {alertCount > 0 && (
              <span onClick={() => setAlertCount(0)} style={{ fontSize: 11, background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 99, padding: "2px 10px", cursor: "pointer", fontWeight: 600 }}>
                +{alertCount} nuevo{alertCount > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <p style={{ fontSize: 12, color: "#374151" }}>
              {fetchedAt ? `Actualizado ${new Date(fetchedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Mercados de alta probabilidad"}
            </p>
            {autoRefresh && <span style={{ fontSize: 11, color: "#374151", fontFamily: "'DM Mono',monospace" }}>{fmtCountdown(countdown)}</span>}
            <button onClick={() => { const n = !autoRefresh; setAutoRefresh(n); if (n && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); }}
              style={{ fontSize: 12, padding: "5px 13px", border: `1px solid ${autoRefresh ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`, borderRadius: 99, background: autoRefresh ? "rgba(99,102,241,0.12)" : "transparent", color: autoRefresh ? "#a5b4fc" : "#6b7280", cursor: "pointer", fontWeight: 500 }}>
              {autoRefresh ? "● Auto ON" : "Auto OFF"}
            </button>
          </div>
        </div>
        <div style={{ marginTop: "1rem", height: 1, background: "linear-gradient(90deg,rgba(99,102,241,0.4),transparent)" }} />
      </header>

      {/* ── FILTROS ── */}
      <section style={{ marginBottom: "1.5rem" }}>
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 14 }}>
            {/* Probabilidad */}
            <div>
              <label style={{ display: "block", fontSize: 10, color: sortKey === "prob" ? "#818cf8" : "#4b5563", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                {sortKey === "prob" && "● "}Probabilidad
              </label>
              <select value={filters.minProb}
                onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, minProb: v })); setSortKey("prob"); setSortDir("desc"); }}
                style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: `1px solid ${sortKey === "prob" ? "rgba(129,140,248,0.35)" : "rgba(255,255,255,0.08)"}`, borderRadius: 9, color: "#d1d5db", fontSize: 13 }}>
                {PROB_OPTS.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
              </select>
            </div>
            {/* Cierra en */}
            <div>
              <label style={{ display: "block", fontSize: 10, color: sortKey === "days" ? "#818cf8" : "#4b5563", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                {sortKey === "days" && "● "}Cierra en
              </label>
              <select value={filters.maxDays}
                onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, maxDays: v })); setSortKey("days"); setSortDir("asc"); }}
                style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: `1px solid ${sortKey === "days" ? "rgba(129,140,248,0.35)" : "rgba(255,255,255,0.08)"}`, borderRadius: 9, color: "#d1d5db", fontSize: 13 }}>
                {DAYS_OPTS.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
              </select>
            </div>
            {/* Volumen */}
            <div>
              <label style={{ display: "block", fontSize: 10, color: sortKey === "volume" ? "#818cf8" : "#4b5563", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                {sortKey === "volume" && "● "}Volumen mín.
              </label>
              <select value={filters.minVol}
                onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, minVol: v })); if (v > 0) { setSortKey("volume"); setSortDir("desc"); } }}
                style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: `1px solid ${sortKey === "volume" ? "rgba(129,140,248,0.35)" : "rgba(255,255,255,0.08)"}`, borderRadius: 9, color: "#d1d5db", fontSize: 13 }}>
                {VOL_OPTS.map(o => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
              </select>
            </div>
            {/* Categoría */}
            <div>
              <label style={{ display: "block", fontSize: 10, color: "#4b5563", marginBottom: 6, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>Categoría</label>
              <select value={filters.category}
                onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
                style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 9, color: "#d1d5db", fontSize: 13 }}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value} style={{ background: "#111" }}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <button onClick={() => doFetch(false)} disabled={loading} className="srchbtn"
            style={{ width: "100%", padding: "11px", background: loading ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.75)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 11, color: "#fff", fontSize: 14, fontWeight: 600, cursor: loading ? "default" : "pointer" }}>
            {loading ? "Buscando mercados..." : "Buscar mercados →"}
          </button>
        </div>
      </section>

      {error && <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, color: "#fca5a5", fontSize: 13, marginBottom: "1.5rem" }}>{error}</div>}

      {/* ── MÉTRICAS ── */}
      {markets.length > 0 && (
        <section style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {[
              { label: "Mercados", value: String(markets.length) },
              { label: "Prob. media", value: fmtPct(avgProb), accent: true },
              { label: "Volumen total", value: fmtVol(totalVol) },
              { label: "Ganancia media", value: ((1 / avgProb - 1) * 100).toFixed(1) + "%", accent: true },
            ].map(({ label, value, accent }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12, padding: "13px 15px" }}>
                <div style={{ fontSize: 21, fontWeight: 600, color: (accent as any) ? "#a5b4fc" : "#e2e2ee", fontFamily: "'DM Mono',monospace" }}>{value}</div>
                <div style={{ fontSize: 10, color: "#374151", marginTop: 3, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── SORT BAR ── */}
      {sorted.length > 0 && (
        <section style={{ marginBottom: "0.875rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginRight: 4 }}>Ordenar</span>
            {(["prob", "days", "volume", "gain"] as SortKey[]).map(key => (
              <button key={key} onClick={() => handleSort(key)} className="sbtn"
                style={{ fontSize: 12, padding: "4px 13px", border: `1px solid ${sortKey === key ? "rgba(129,140,248,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: 99, background: sortKey === key ? "rgba(99,102,241,0.16)" : "transparent", color: sortKey === key ? "#a5b4fc" : "#6b7280", fontWeight: sortKey === key ? 600 : 400 }}>
                {sortLabel(key)}
              </button>
            ))}
            {newIds.size > 0 && <span style={{ marginLeft: "auto", fontSize: 11, color: "#fca5a5", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 99, padding: "3px 10px" }}>{newIds.size} nuevo{newIds.size > 1 ? "s" : ""}</span>}
          </div>
          <div style={{ marginTop: 8, height: 1, background: "rgba(255,255,255,0.04)" }} />
        </section>
      )}

      {/* ── LISTA ── */}
      <section style={{ marginBottom: "2.5rem" }}>
        {loading && <div style={{ textAlign: "center", padding: "3rem 0", color: "#4b5563", fontSize: 14 }}>Cargando mercados...</div>}
        {!loading && markets.length === 0 && <div style={{ textAlign: "center", padding: "3rem 0", color: "#374151", fontSize: 14 }}>Sin resultados — prueba a ampliar los filtros.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {!loading && sorted.map((m, i) => <MarketCard key={m.id} market={m} isNew={newIds.has(m.id)} rank={i + 1} />)}
        </div>
      </section>

      {/* ── TERMINALES (siempre visibles) ── */}
      <section>
        <div style={{ height: 1, background: "linear-gradient(90deg,rgba(99,102,241,0.3),transparent)", marginBottom: "1.5rem" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Terminal 1 */}
          <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1rem", height: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f97316", display: "inline-block", animation: "pulse 2s infinite" }} />
              <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Cierran pronto</span>
              <span style={{ fontSize: 10, color: "#374151", marginLeft: "auto" }}>≤ 72h</span>
            </div>
            <div style={{ height: "calc(100% - 34px)" }}>
              <UrgentTerminal markets={markets} />
            </div>
          </div>
          {/* Terminal 2 */}
          <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "1rem", height: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", display: "inline-block" }} />
              <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Noticias Crypto</span>
              <span style={{ fontSize: 10, color: "#374151", marginLeft: "auto" }}>CoinGecko</span>
            </div>
            <div style={{ height: "calc(100% - 34px)" }}>
              <NewsTerminal />
            </div>
          </div>
        </div>
      </section>

      <footer style={{ marginTop: "2rem", paddingTop: "1.5rem", borderTop: "1px solid rgba(255,255,255,0.03)", textAlign: "center" }}>
        <span style={{ fontSize: 11, color: "#1f2937" }}>PolyEdge · Datos vía Gamma API · {markets.length} mercados</span>
      </footer>
    </main>
  );
}

// ── Market Card ───────────────────────────────────────────────────────────────
function MarketCard({ market: m, isNew, rank }: { market: ProcessedMarket; isNew: boolean; rank: number }) {
  const pct = Math.round(m.bestProb * 100);
  const noPct = 100 - pct;
  const isVH = pct >= 95;
  const probColor = isVH ? "#4ade80" : pct >= 90 ? "#86efac" : "#bef264";
  const probBg = isVH ? "rgba(74,222,128,0.07)" : "rgba(190,242,100,0.05)";
  const probBorder = isVH ? "rgba(74,222,128,0.2)" : "rgba(190,242,100,0.12)";
  const gain = ((1 / m.bestProb - 1) * 100).toFixed(1);
  const estTraders = Math.max(1, Math.round(m.volume / 200));
  const estOrders = Math.max(0, Math.round(m.volume24hr / 50));

  return (
    <div className="mcard" style={{ background: isNew ? "rgba(99,102,241,0.04)" : "rgba(255,255,255,0.015)", border: `1px solid ${isNew ? "rgba(99,102,241,0.35)" : "rgba(255,255,255,0.06)"}`, borderRadius: 15, padding: "1rem 1.1rem", position: "relative" }}>
      {isNew && <span style={{ position: "absolute", top: -10, left: 16, fontSize: 10, fontWeight: 700, background: "#6366f1", color: "#fff", borderRadius: 99, padding: "2px 9px", letterSpacing: "0.08em" }}>NUEVO</span>}
      <span style={{ position: "absolute", top: 12, right: 14, fontSize: 10, color: "#1f2937", fontFamily: "monospace" }}>#{rank}</span>

      {/* Fila superior: badge + pregunta + sparkline */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ flexShrink: 0, width: 58, height: 58, borderRadius: 13, background: probBg, border: `1px solid ${probBorder}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: probColor, fontFamily: "'DM Mono',monospace", lineHeight: 1 }}>{pct}%</span>
          <span style={{ fontSize: 8, color: probColor, opacity: 0.65, fontWeight: 600, letterSpacing: "0.04em" }}>{m.bestOutcomeName.slice(0, 6).toUpperCase()}</span>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13.5, color: "#c9cad6", lineHeight: 1.5, marginBottom: 5 }}>{m.question}</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {m.oneDayPriceChange !== 0 && (
              <span style={{ fontSize: 11, color: m.oneDayPriceChange > 0 ? "#4ade80" : "#f87171", fontFamily: "'DM Mono',monospace", fontWeight: 500 }}>
                {m.oneDayPriceChange > 0 ? "▲" : "▼"} {Math.abs(m.oneDayPriceChange * 100).toFixed(1)}%
              </span>
            )}
            {m.category && <span style={{ fontSize: 10, color: "#374151", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5, padding: "1px 7px" }}>{m.category}</span>}
          </div>
        </div>
        {/* Sparkline */}
        <div style={{ flexShrink: 0, paddingTop: 6 }}>
          <Sparkline change={m.oneDayPriceChange} prob={m.bestProb} />
        </div>
      </div>

      {/* Fila de stats */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)", flexWrap: "wrap" }}>
        {/* YES */}
        <div style={{ textAlign: "center", padding: "4px 9px", background: "rgba(74,222,128,0.07)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 7 }}>
          <div style={{ fontSize: 9, color: "#4ade80", fontWeight: 700, letterSpacing: "0.06em" }}>YES</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#4ade80", fontFamily: "'DM Mono',monospace" }}>{pct}¢</div>
        </div>
        {/* NO */}
        <div style={{ textAlign: "center", padding: "4px 9px", background: "rgba(248,113,113,0.07)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: 7 }}>
          <div style={{ fontSize: 9, color: "#f87171", fontWeight: 700, letterSpacing: "0.06em" }}>NO</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171", fontFamily: "'DM Mono',monospace" }}>{noPct}¢</div>
        </div>
        {/* Volumen */}
        <div style={{ textAlign: "center", padding: "2px 8px" }}>
          <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: "0.06em" }}>VOL</div>
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{fmtVol(m.volume)}</div>
          <div style={{ fontSize: 9, color: "#1f2937" }}>{fmtVol(m.volume24hr)}/24h</div>
        </div>
        {/* Órdenes */}
        <div style={{ textAlign: "center", padding: "2px 8px" }}>
          <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: "0.06em" }}>ÓRDENES</div>
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{estOrders > 0 ? estOrders : "—"}</div>
          <div style={{ fontSize: 9, color: "#1f2937" }}>24h</div>
        </div>
        {/* Traders */}
        <div style={{ textAlign: "center", padding: "2px 8px" }}>
          <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: "0.06em" }}>TRADERS</div>
          <div style={{ fontSize: 13, color: "#9ca3af", fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>{estTraders > 999 ? fmtVol(estTraders).replace("$","") : estTraders}</div>
          <div style={{ fontSize: 9, color: "#1f2937" }}>aprox.</div>
        </div>
        {/* Ganancia + tiempo + link */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#374151" }}>ganancia · {fmtDays(m.daysLeft)}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#4ade80", fontFamily: "'DM Mono',monospace" }}>+{gain}%</div>
          </div>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="pl"
            style={{ fontSize: 12, color: "#818cf8", textDecoration: "none", padding: "7px 12px", border: "1px solid rgba(129,140,248,0.22)", borderRadius: 9, fontWeight: 500, whiteSpace: "nowrap" }}>
            Ver →
          </a>
        </div>
      </div>

      {/* Spread */}
      {m.bestBid > 0 && m.bestAsk > 0 && (
        <div style={{ marginTop: 6, fontSize: 10, color: "#1f2937", fontFamily: "'DM Mono',monospace" }}>
          bid {fmtPct(m.bestBid)} · ask {fmtPct(m.bestAsk)} · spread {(m.spread * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
