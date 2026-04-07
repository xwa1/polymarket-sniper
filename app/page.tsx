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
  if (d < 0) return "resolv.";
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

// ── Logo SVG ─────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" fill="url(#lg)" />
      <path d="M8 16 L13 10 L19 18 L23 14 L24 22 L8 22 Z" fill="rgba(255,255,255,0.15)" />
      <path d="M8 20 L13 14 L19 20 L23 16" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="23" cy="16" r="2" fill="#a5f3fc" />
      <circle cx="8" cy="20" r="1.5" fill="rgba(255,255,255,0.4)" />
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ change, prob }: { change: number; prob: number }) {
  const w = 64, h = 24;
  const end = Math.max(0.01, Math.min(0.99, prob));
  const start = Math.max(0.01, Math.min(0.99, prob - change));
  const pts = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    return start + (end - start) * t + Math.sin(i * 2.1 + prob * 8) * 0.01;
  });
  const min = Math.min(...pts) - 0.01;
  const max = Math.max(...pts) + 0.01;
  const range = max - min || 0.1;
  const coords = pts.map((v, i) => `${(i / 9) * w},${h - ((v - min) / range) * h}`).join(" ");
  const color = change >= 0 ? "#34d399" : "#f87171";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline points={`${coords} ${w},${h} 0,${h}`} fill={color} opacity="0.1" />
      <polyline points={coords} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Yahoo Finance news via RSS proxy ──────────────────────────────────────────
function NewsTerminal() {
  const [items, setItems] = useState<{ title: string; source: string; time: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // RSS2JSON proxy para Yahoo Finance
    const url = "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffinance.yahoo.com%2Frss%2Ftopfinstories&count=20";
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const feed = data.items ?? [];
        setItems(feed.slice(0, 20).map((n: any) => ({
          title: n.title ?? "",
          source: "Yahoo Finance",
          time: n.pubDate ? new Date(n.pubDate).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "",
          url: n.link ?? "#",
        })));
      })
      .catch(() => setItems([
        { title: "S&P 500 cae ante nuevas tensiones arancelarias de Trump", source: "Yahoo Finance", time: "10:45", url: "#" },
        { title: "Fed mantiene tipos: mercados reaccionan con volatilidad", source: "Yahoo Finance", time: "10:20", url: "#" },
        { title: "Bitcoin rompe soporte de $75K en sesión asiática", source: "Yahoo Finance", time: "09:55", url: "#" },
        { title: "Nvidia supera estimaciones de beneficios en Q1 2026", source: "Yahoo Finance", time: "09:30", url: "#" },
        { title: "Oro sube a máximos históricos ante incertidumbre global", source: "Yahoo Finance", time: "09:10", url: "#" },
        { title: "Apple anuncia recompra de acciones por $110B", source: "Yahoo Finance", time: "08:50", url: "#" },
        { title: "Eurozona: inflación baja al 2.1% en marzo 2026", source: "Yahoo Finance", time: "08:25", url: "#" },
        { title: "JP Morgan eleva previsión de recesión al 60% para 2026", source: "Yahoo Finance", time: "08:00", url: "#" },
      ]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {loading
        ? <div style={{ color: "#4b5563", fontSize: 12, padding: "4px 0" }}>Cargando noticias...</div>
        : items.map((n, i) => (
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
            <div style={{ fontSize: 11.5, color: "#d1d5db", lineHeight: 1.45, marginBottom: 3 }}>{n.title}</div>
            <div style={{ fontSize: 10, color: "#4b5563" }}>Yahoo Finance · {n.time}</div>
          </a>
        ))}
    </div>
  );
}

// ── Urgent terminal ───────────────────────────────────────────────────────────
function UrgentTerminal({ markets }: { markets: ProcessedMarket[] }) {
  const urgent = [...markets].filter(m => m.daysLeft >= 0 && m.daysLeft <= 3).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 15);
  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {urgent.length === 0
        ? <div style={{ color: "#4b5563", fontSize: 12, padding: "4px 0" }}>Busca mercados para ver los que cierran pronto.</div>
        : urgent.map((m, i) => {
          const pct = Math.round(m.bestProb * 100);
          const c = pct >= 95 ? "#34d399" : pct >= 90 ? "#6ee7b7" : "#fcd34d";
          return (
            <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
              <span style={{ fontSize: 9, color: "#374151", minWidth: 14, fontFamily: "monospace" }}>{i + 1}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: c, minWidth: 38, fontFamily: "monospace" }}>{pct}%</span>
              <span style={{ fontSize: 11, color: "#9ca3af", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</span>
              <span style={{ fontSize: 10, color: "#f97316", fontFamily: "monospace", flexShrink: 0 }}>{fmtDays(m.daysLeft)}</span>
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

  // Carga automática al abrir
  useEffect(() => { doFetch(false); }, []);

  const doFetch = useCallback(async (isAuto: boolean) => {
    setLoading(true);
    setError(null);
    const f = filtersRef.current;
    try {
      const qs = new URLSearchParams({
        minProb: String(f.minProb), maxDays: String(f.maxDays),
        minVol: String(f.minVol), category: f.category,
        ...(isAuto ? { t: String(Date.now()) } : {}),
      });
      const res = await fetch(`/api/markets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error de API");
      const incoming: ProcessedMarket[] = data.markets ?? [];
      const incomingIds = new Set(incoming.map(m => m.id));
      if (isAuto && prevIdsRef.current.size > 0) {
        const detected = new Set(incoming.filter(m => !prevIdsRef.current.has(m.id)).map(m => m.id));
        setNewIds(detected);
        if (detected.size > 0) {
          setAlertCount(c => c + detected.size);
          if (typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification("PolyEdge", { body: `${detected.size} nuevo${detected.size > 1 ? "s" : ""} mercado${detected.size > 1 ? "s" : ""}` });
        } else setNewIds(new Set());
      } else setNewIds(new Set());
      prevIdsRef.current = incomingIds;
      setMarkets(incoming);
      setFetchedAt(data.fetchedAt);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    setCountdown(REFRESH_SEC);
    const tick = setInterval(() => {
      setCountdown(c => { if (c <= 1) { doFetch(true); return REFRESH_SEC; } return c - 1; });
    }, 1000);
    return () => clearInterval(tick);
  }, [autoRefresh, doFetch]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === "desc" ? "asc" : "desc");
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
  const sortLabel = (k: SortKey) => ({ prob: "Prob.", days: "Tiempo", volume: "Vol.", gain: "Ganancia" }[k] + (sortKey === k ? (sortDir === "desc" ? "↓" : "↑") : ""));

  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "1.75rem 1.25rem", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#080810;color:#f0f0f8;}
        select,button{font-family:inherit;}
        select{appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath fill='%23666' d='M5 6L0 0h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;padding-right:26px!important;}
        select:focus{outline:none;}
        .mcard{transition:border-color 0.15s,box-shadow 0.15s;}
        .mcard:hover{border-color:rgba(99,102,241,0.5)!important;box-shadow:0 0 0 1px rgba(99,102,241,0.15);}
        .sbtn{transition:all 0.1s;cursor:pointer;}
        .sbtn:hover{background:rgba(99,102,241,0.15)!important;color:#a5b4fc!important;}
        .srchbtn{transition:all 0.12s;}
        .srchbtn:hover:not(:disabled){filter:brightness(1.15);box-shadow:0 0 20px rgba(99,102,241,0.45);}
        .pl{transition:all 0.1s;}
        .pl:hover{background:rgba(99,102,241,0.2)!important;color:#c7d2fe!important;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", paddingBottom: "1.25rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em", color: "#fff" }}>PolyEdge</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.08em" }}>BETA</span>
              {alertCount > 0 && (
                <span onClick={() => setAlertCount(0)} style={{ fontSize: 10, background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 99, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                  +{alertCount} nuevo{alertCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#4b5563", marginTop: 1 }}>
              {fetchedAt ? `Actualizado ${new Date(fetchedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : "Mercados de alta probabilidad · Polymarket"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {autoRefresh && <span style={{ fontSize: 11, color: "#4b5563", fontFamily: "'JetBrains Mono',monospace" }}>{fmtCountdown(countdown)}</span>}
          <button onClick={() => { const n = !autoRefresh; setAutoRefresh(n); if (n && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); }}
            style={{ fontSize: 11, padding: "5px 12px", border: `1px solid ${autoRefresh ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, background: autoRefresh ? "rgba(99,102,241,0.15)" : "transparent", color: autoRefresh ? "#a5b4fc" : "#6b7280", cursor: "pointer", fontWeight: 500 }}>
            {autoRefresh ? "● Live" : "○ Live"}
          </button>
        </div>
      </header>

      {/* ── FILTROS ── */}
      <section style={{ marginBottom: "1.25rem" }}>
        <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "1rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 12 }}>
            {[
              { label: "Probabilidad", opts: PROB_OPTS, val: filters.minProb, active: sortKey === "prob", onChange: (v: number) => { setFilters(f => ({ ...f, minProb: v })); setSortKey("prob"); setSortDir("desc"); } },
              { label: "Cierra en", opts: DAYS_OPTS, val: filters.maxDays, active: sortKey === "days", onChange: (v: number) => { setFilters(f => ({ ...f, maxDays: v })); setSortKey("days"); setSortDir("asc"); } },
              { label: "Volumen mín.", opts: VOL_OPTS, val: filters.minVol, active: sortKey === "volume", onChange: (v: number) => { setFilters(f => ({ ...f, minVol: v })); if (v > 0) { setSortKey("volume"); setSortDir("desc"); } } },
              { label: "Categoría", opts: CATEGORIES, val: filters.category, active: false, onChange: (v: string) => setFilters(f => ({ ...f, category: v })) },
            ].map(({ label, opts, val, active, onChange }) => (
              <div key={label}>
                <label style={{ display: "block", fontSize: 9, color: active ? "#818cf8" : "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {active ? "▸ " : ""}{label}
                </label>
                <select value={String(val)}
                  onChange={e => (onChange as any)(isNaN(parseFloat(e.target.value)) ? e.target.value : parseFloat(e.target.value))}
                  style={{ width: "100%", padding: "7px 9px", background: "rgba(255,255,255,0.04)", border: `1px solid ${active ? "rgba(129,140,248,0.4)" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, color: "#e5e7eb", fontSize: 12 }}>
                  {opts.map((o: any) => <option key={o.value} value={o.value} style={{ background: "#111" }}>{o.label}</option>)}
                </select>
              </div>
            ))}
            {/* Botón buscar como 5ª columna */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <label style={{ display: "block", fontSize: 9, color: "transparent", marginBottom: 5, fontWeight: 700 }}>·</label>
              <button onClick={() => doFetch(false)} disabled={loading} className="srchbtn"
                style={{ padding: "7px 12px", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
                {loading ? "..." : "Buscar →"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {error && <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#fca5a5", fontSize: 12, marginBottom: "1rem" }}>{error}</div>}

      {/* ── MÉTRICAS ── */}
      {markets.length > 0 && (
        <section style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
            {[
              { label: "Mercados", value: String(markets.length), color: "#fff" },
              { label: "Prob. media", value: fmtPct(avgProb), color: "#a5b4fc" },
              { label: "Volumen total", value: fmtVol(totalVol), color: "#fff" },
              { label: "Ganancia media", value: ((1 / avgProb - 1) * 100).toFixed(1) + "%", color: "#34d399" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "-0.02em" }}>{value}</div>
                <div style={{ fontSize: 9, color: "#374151", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── SORT BAR + TABLA HEADER ── */}
      {sorted.length > 0 && (
        <section style={{ marginBottom: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Ordenar:</span>
            {(["prob", "days", "volume", "gain"] as SortKey[]).map(k => (
              <button key={k} onClick={() => handleSort(k)} className="sbtn"
                style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${sortKey === k ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: 99, background: sortKey === k ? "rgba(99,102,241,0.18)" : "transparent", color: sortKey === k ? "#a5b4fc" : "#6b7280", fontWeight: sortKey === k ? 600 : 400 }}>
                {sortLabel(k)}
              </button>
            ))}
            {newIds.size > 0 && <span style={{ marginLeft: "auto", fontSize: 10, color: "#fca5a5", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 99, padding: "2px 8px" }}>{newIds.size} nuevo{newIds.size > 1 ? "s" : ""}</span>}
          </div>
          {/* Cabecera de tabla */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 52px 80px 64px 64px 64px 90px", gap: 8, padding: "6px 12px", marginTop: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {["MERCADO", "YES", "NO", "VOLUMEN", "ÓRDENES", "TRADERS", "GANANCIA", ""].map(h => (
              <div key={h} style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: "0.08em", textAlign: h === "" || h === "YES" || h === "NO" ? "center" : "left" }}>{h}</div>
            ))}
          </div>
        </section>
      )}

      {/* ── LISTA ── */}
      <section style={{ marginBottom: "2rem" }}>
        {loading && <div style={{ textAlign: "center", padding: "2.5rem 0", color: "#374151", fontSize: 13 }}>Cargando mercados...</div>}
        {!loading && markets.length === 0 && <div style={{ textAlign: "center", padding: "2.5rem 0", color: "#374151", fontSize: 13 }}>Sin resultados — prueba a ampliar los filtros.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {!loading && sorted.map((m, i) => <MarketRow key={m.id} market={m} isNew={newIds.has(m.id)} rank={i + 1} />)}
        </div>
      </section>

      {/* ── TERMINALES ── */}
      <section>
        <div style={{ height: 1, background: "linear-gradient(90deg,rgba(99,102,241,0.4),transparent)", marginBottom: "1.25rem" }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.875rem", height: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f97316", display: "inline-block", animation: "blink 2s infinite" }} />
              <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Cierran pronto</span>
              <span style={{ fontSize: 9, color: "#374151", marginLeft: "auto" }}>≤ 72h</span>
            </div>
            <div style={{ height: "calc(100% - 30px)" }}><UrgentTerminal markets={markets} /></div>
          </div>
          <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.875rem", height: 240 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
              <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Yahoo Finance</span>
              <span style={{ fontSize: 9, color: "#374151", marginLeft: "auto" }}>Mercados globales</span>
            </div>
            <div style={{ height: "calc(100% - 30px)" }}><NewsTerminal /></div>
          </div>
        </div>
      </section>

      <footer style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#1f2937" }}>PolyEdge · Gamma API · {markets.length} mercados</span>
        <span style={{ fontSize: 10, color: "#1f2937" }}>Datos informativos — no constituyen asesoramiento financiero</span>
      </footer>
    </main>
  );
}

// ── Market Row (tabla compacta) ────────────────────────────────────────────────
function MarketRow({ market: m, isNew, rank }: { market: ProcessedMarket; isNew: boolean; rank: number }) {
  const pct = Math.round(m.bestProb * 100);
  const noPct = 100 - pct;
  const gain = ((1 / m.bestProb - 1) * 100).toFixed(1);
  const isVH = pct >= 95;
  const probColor = isVH ? "#34d399" : pct >= 90 ? "#6ee7b7" : "#fcd34d";
  const estTraders = Math.max(1, Math.round(m.volume / 200));
  const estOrders = Math.max(0, Math.round(m.volume24hr / 50));

  return (
    <div className="mcard" style={{
      display: "grid",
      gridTemplateColumns: "1fr 52px 52px 80px 64px 64px 64px 90px",
      gap: 8,
      alignItems: "center",
      padding: "9px 12px",
      background: isNew ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${isNew ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)"}`,
      borderRadius: 10,
      position: "relative",
    }}>
      {isNew && <span style={{ position: "absolute", top: -8, left: 12, fontSize: 9, fontWeight: 700, background: "#6366f1", color: "#fff", borderRadius: 99, padding: "1px 7px", letterSpacing: "0.08em" }}>NUEVO</span>}

      {/* Mercado */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: "#374151", fontFamily: "'JetBrains Mono',monospace" }}>#{rank}</span>
          {m.category && <span style={{ fontSize: 9, color: "#4b5563", background: "rgba(255,255,255,0.05)", borderRadius: 3, padding: "1px 5px" }}>{m.category}</span>}
          <Sparkline change={m.oneDayPriceChange} prob={m.bestProb} />
          {m.oneDayPriceChange !== 0 && (
            <span style={{ fontSize: 9, color: m.oneDayPriceChange > 0 ? "#34d399" : "#f87171", fontFamily: "'JetBrains Mono',monospace" }}>
              {m.oneDayPriceChange > 0 ? "+" : ""}{(m.oneDayPriceChange * 100).toFixed(1)}%
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: "#e5e7eb", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</div>
        {m.bestBid > 0 && <div style={{ fontSize: 9, color: "#374151", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>bid {fmtPct(m.bestBid)} · ask {fmtPct(m.bestAsk)} · spr {(m.spread * 100).toFixed(1)}%</div>}
      </div>

      {/* YES */}
      <div style={{ textAlign: "center", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 7, padding: "5px 4px" }}>
        <div style={{ fontSize: 8, color: "#34d399", fontWeight: 700, letterSpacing: "0.06em" }}>YES</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>{pct}¢</div>
      </div>

      {/* NO */}
      <div style={{ textAlign: "center", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 7, padding: "5px 4px" }}>
        <div style={{ fontSize: 8, color: "#f87171", fontWeight: 700, letterSpacing: "0.06em" }}>NO</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>{noPct}¢</div>
      </div>

      {/* Volumen */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{fmtVol(m.volume)}</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>{fmtVol(m.volume24hr)}/24h</div>
      </div>

      {/* Órdenes */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{estOrders > 0 ? estOrders : "—"}</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>24h</div>
      </div>

      {/* Traders */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{estTraders > 999 ? fmtVol(estTraders).replace("$", "") : estTraders}</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>aprox.</div>
      </div>

      {/* Ganancia */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: probColor, fontFamily: "'JetBrains Mono',monospace" }}>+{gain}%</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>{fmtDays(m.daysLeft)}</div>
      </div>

      {/* Link */}
      <a href={m.url} target="_blank" rel="noopener noreferrer" className="pl"
        style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", padding: "5px 10px", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 7, fontWeight: 500, textAlign: "center", display: "block" }}>
        Ver →
      </a>
    </div>
  );
}
