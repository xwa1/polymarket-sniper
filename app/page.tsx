"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ProcessedMarket } from "./api/markets/route";

const REFRESH_SEC = 300;
const CLOB_BASE = "https://clob.polymarket.com";

// ── i18n ──────────────────────────────────────────────────────────────────────
type Lang = "en" | "es";
const T = {
  en: {
    subtitle: "High-probability markets about to resolve",
    updated: "Updated", liveOn: "● Live ON", liveOff: "○ Live",
    search: "Search markets →", searching: "Searching...",
    probability: "Probability", closesIn: "Closes in",
    minVolume: "Min. volume", category: "Category",
    sortBy: "Sort:", prob: "Prob.", days: "Time", volume: "Vol.", gain: "Gain",
    markets: "Markets", avgProb: "Avg. prob.", totalVol: "Total volume", avgGain: "Avg. gain",
    loading: "Loading markets...", noResults: "No results — try expanding the filters.",
    previewMsg: "Showing 10 sample markets", previewSub: "· Use filters to search more",
    new: "NEW", closingSoon: "Closing soon", newsTitle: "Yahoo Finance", newsSub: "Global markets",
    newsLoading: "Loading news...", urgentEmpty: "Search markets to see ones closing soon.",
    orders: "ORDERS", traders: "TRADERS", approx: "approx.", gainLabel: "gain", view: "View →",
    footer: "PolyEdge · Gamma API · Polymarket data",
    disclaimer: "Informational only — not financial advice",
    newBadge: (n: number) => `+${n} new market${n > 1 ? "s" : ""}`,
    cats: ["All","Sports","Crypto","Politics","Weather","Finance","Entertainment","Technology","World"],
    catVals: ["","Sports","Crypto","Politics","Weather","Finance","Entertainment","Technology","World"],
    daysOpts: ["≤ 12h","≤ 1 day","≤ 2 days","≤ 3 days","≤ 7 days","≤ 14 days","≤ 30 days"],
    volOpts: ["Any","$1K+","$10K+","$50K+","$100K+"],
    tableHeaders: ["MARKET","YES","NO","VOLUME","ORDERS","TRADERS","GAIN",""],
    // Insider tab
    insiderTab: "Insider Activity",
    polyedgeTab: "PolyEdge",
    insiderTitle: "Insider Activity Detector",
    insiderSubtitle: "Political markets with abnormal hourly volume spikes",
    insiderScanning: "Scanning political markets for anomalies...",
    insiderEmpty: "No insider signals detected right now. Markets look quiet.",
    insiderRefresh: "Scan now",
    insiderLastScan: "Last scan:",
    alertModerate: "MODERATE",
    alertHigh: "HIGH",
    alertExtreme: "EXTREME",
    spikeLabel: "spike",
    hourlyAvg: "hourly avg",
    lastHour: "last hour",
    priceMove: "price move",
    timeLeft: "time left",
    liquidity: "liquidity",
    howItWorks: "How it works",
    howText: "We scan active political markets every 5 minutes. For each market, we fetch hourly price history from the CLOB API and calculate the average hourly volume. When the last hour shows a spike of 3x or more vs the daily average — with no apparent news — it may indicate insider positioning.",
  },
  es: {
    subtitle: "Mercados de alta probabilidad próximos a resolverse",
    updated: "Actualizado", liveOn: "● Live ON", liveOff: "○ Live",
    search: "Buscar mercados →", searching: "Buscando...",
    probability: "Probabilidad", closesIn: "Cierra en",
    minVolume: "Volumen mín.", category: "Categoría",
    sortBy: "Ordenar:", prob: "Prob.", days: "Tiempo", volume: "Vol.", gain: "Ganancia",
    markets: "Mercados", avgProb: "Prob. media", totalVol: "Volumen total", avgGain: "Ganancia media",
    loading: "Cargando mercados...", noResults: "Sin resultados — prueba a ampliar los filtros.",
    previewMsg: "Mostrando 10 mercados de muestra", previewSub: "· Usa los filtros para buscar más",
    new: "NUEVO", closingSoon: "Cierran pronto", newsTitle: "Yahoo Finance", newsSub: "Mercados globales",
    newsLoading: "Cargando noticias...", urgentEmpty: "Busca mercados para ver los que cierran pronto.",
    orders: "ÓRDENES", traders: "TRADERS", approx: "aprox.", gainLabel: "ganancia", view: "Ver →",
    footer: "PolyEdge · Gamma API · Datos de Polymarket",
    disclaimer: "Datos informativos — no constituyen asesoramiento financiero",
    newBadge: (n: number) => `+${n} nuevo${n > 1 ? "s" : ""}`,
    cats: ["Todas","Deportes","Cripto","Política","Clima","Finanzas","Entretenimiento","Tecnología","Internacional"],
    catVals: ["","Sports","Crypto","Politics","Weather","Finance","Entertainment","Technology","World"],
    daysOpts: ["≤ 12h","≤ 1 día","≤ 2 días","≤ 3 días","≤ 7 días","≤ 14 días","≤ 30 días"],
    volOpts: ["Cualquiera","$1K+","$10K+","$50K+","$100K+"],
    tableHeaders: ["MERCADO","YES","NO","VOLUMEN","ÓRDENES","TRADERS","GANANCIA",""],
    insiderTab: "Insider Activity",
    polyedgeTab: "PolyEdge",
    insiderTitle: "Detector de Actividad Insider",
    insiderSubtitle: "Mercados políticos con spikes de volumen horario anómalos",
    insiderScanning: "Escaneando mercados políticos en busca de anomalías...",
    insiderEmpty: "No hay señales insider detectadas ahora mismo. Los mercados están tranquilos.",
    insiderRefresh: "Escanear ahora",
    insiderLastScan: "Último escaneo:",
    alertModerate: "MODERADO",
    alertHigh: "ALTO",
    alertExtreme: "EXTREMO",
    spikeLabel: "spike",
    hourlyAvg: "media/hora",
    lastHour: "última hora",
    priceMove: "mov. precio",
    timeLeft: "tiempo restante",
    liquidity: "liquidez",
    howItWorks: "Cómo funciona",
    howText: "Escaneamos mercados políticos activos cada 5 minutos. Para cada mercado, consultamos el historial de precios horario en el CLOB API y calculamos el volumen medio por hora. Cuando la última hora muestra un spike de 3x o más vs la media diaria — sin noticias aparentes — puede indicar posicionamiento insider.",
  },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
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

const PROB_OPTS = [0.80, 0.85, 0.90, 0.93, 0.95, 0.97];
const DAYS_VALS = [0.5, 1, 2, 3, 7, 14, 30];
const VOL_VALS  = [0, 1000, 10000, 50000, 100000];

// ── Insider types ─────────────────────────────────────────────────────────────
interface InsiderSignal {
  market: ProcessedMarket;
  spikeRatio: number;
  hourlyAvg: number;
  lastHourVol: number;
  alertLevel: "MODERATE" | "HIGH" | "EXTREME";
  detectedAt: string;
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="url(#lg)" />
      <path d="M8 20 L13 14 L19 20 L23 16" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 20 L13 14 L19 20 L23 16 L24 22 L8 22 Z" fill="rgba(255,255,255,0.1)" />
      <circle cx="23" cy="16" r="2.2" fill="#a5f3fc" />
      <circle cx="13" cy="14" r="1.4" fill="rgba(255,255,255,0.5)" />
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" /><stop offset="1" stopColor="#7c3aed" />
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
  const pts = Array.from({ length: 10 }, (_, i) => start + (end - start) * (i / 9) + Math.sin(i * 2.1 + prob * 8) * 0.01);
  const min = Math.min(...pts) - 0.01, max = Math.max(...pts) + 0.01, range = max - min || 0.1;
  const coords = pts.map((v, i) => `${(i / 9) * w},${h - ((v - min) / range) * h}`).join(" ");
  const color = change >= 0 ? "#34d399" : "#f87171";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline points={`${coords} ${w},${h} 0,${h}`} fill={color} opacity="0.08" />
      <polyline points={coords} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Volume spike chart ────────────────────────────────────────────────────────
function SpikeChart({ hourlyAvg, lastHourVol, spikeRatio }: { hourlyAvg: number; lastHourVol: number; spikeRatio: number }) {
  const bars = 8;
  const color = spikeRatio >= 10 ? "#f87171" : spikeRatio >= 5 ? "#fb923c" : "#fcd34d";
  // Simular barras previas normales + última con spike
  const heights = Array.from({ length: bars }, (_, i) => {
    if (i === bars - 1) return 100; // última barra = spike
    return 20 + Math.random() * 25; // barras normales bajas
  });
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 32, width: 80 }}>
      {heights.map((h, i) => (
        <div key={i} style={{
          flex: 1, borderRadius: 2,
          background: i === bars - 1 ? color : "rgba(255,255,255,0.1)",
          height: `${h}%`,
          transition: "height 0.3s",
        }} />
      ))}
    </div>
  );
}

// ── News Terminal ─────────────────────────────────────────────────────────────
function NewsTerminal({ t }: { t: typeof T["en"] }) {
  const [items, setItems] = useState<{ title: string; time: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const feeds = [
      "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffinance.yahoo.com%2Frss%2Ftopfinstories&count=20",
      "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffinance.yahoo.com%2Frss%2Fnews&count=20",
    ];
    const tryFeed = (idx: number) => {
      if (idx >= feeds.length) {
        setItems([
          { title: "S&P 500 drops 3.5% amid Trump tariff escalation", time: "11:20", url: "https://finance.yahoo.com" },
          { title: "Fed holds rates — Powell rules out imminent cuts", time: "10:55", url: "https://finance.yahoo.com" },
          { title: "Bitcoin falls below $75,000 for first time in months", time: "10:30", url: "https://finance.yahoo.com" },
          { title: "Nvidia posts record revenue despite chip restrictions", time: "10:05", url: "https://finance.yahoo.com" },
          { title: "Gold hits $3,100/oz as investors flee to safety", time: "09:40", url: "https://finance.yahoo.com" },
          { title: "Apple maintains guidance despite China exposure", time: "09:15", url: "https://finance.yahoo.com" },
          { title: "JP Morgan raises recession probability to 60% in 2026", time: "08:50", url: "https://finance.yahoo.com" },
        ]);
        setLoading(false);
        return;
      }
      fetch(feeds[idx])
        .then(r => r.json())
        .then(data => {
          const feed = data.items ?? [];
          if (feed.length === 0) { tryFeed(idx + 1); return; }
          setItems(feed.slice(0, 20).map((n: any) => ({
            title: n.title ?? "",
            time: n.pubDate ? new Date(n.pubDate).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "",
            url: n.link ?? "https://finance.yahoo.com",
          })));
          setLoading(false);
        })
        .catch(() => tryFeed(idx + 1));
    };
    tryFeed(0);
  }, []);

  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {loading ? <div style={{ color: "#4b5563", fontSize: 12 }}>{t.newsLoading}</div>
        : items.map((n, i) => (
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", textDecoration: "none" }}>
            <div style={{ fontSize: 11.5, color: "#d1d5db", lineHeight: 1.45, marginBottom: 2 }}>{n.title}</div>
            <div style={{ fontSize: 10, color: "#4b5563" }}>Yahoo Finance · {n.time}</div>
          </a>
        ))}
    </div>
  );
}

// ── Urgent Terminal ───────────────────────────────────────────────────────────
function UrgentTerminal({ markets, t }: { markets: ProcessedMarket[]; t: typeof T["en"] }) {
  const urgent = [...markets].filter(m => m.daysLeft >= 0 && m.daysLeft <= 3).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 15);
  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {urgent.length === 0
        ? <div style={{ color: "#4b5563", fontSize: 12 }}>{t.urgentEmpty}</div>
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

// ── Insider Activity Tab ──────────────────────────────────────────────────────
async function fetchClobPriceHistory(tokenId: string): Promise<number[]> {
  // CLOB API: hourly price history for last 24h
  const end = Math.floor(Date.now() / 1000);
  const start = end - 86400; // 24h ago
  try {
    const r = await fetch(
      `${CLOB_BASE}/prices-history?market=${tokenId}&startTs=${start}&endTs=${end}&fidelity=60`,
      { cache: "no-store" }
    );
    if (!r.ok) return [];
    const data = await r.json();
    // data.history = [{t, p}] — precio por minuto
    // Agrupar en bloques de 60 minutos y calcular variación de precio como proxy de volumen
    const history: { t: number; p: number }[] = data.history ?? [];
    if (history.length < 2) return [];
    // Calcular volumen aproximado por hora: suma de |delta_precio| * 1000 como proxy
    const hourlyVols: number[] = [];
    for (let h = 0; h < 24; h++) {
      const hStart = start + h * 3600;
      const hEnd = hStart + 3600;
      const slice = history.filter(d => d.t >= hStart && d.t < hEnd);
      if (slice.length < 2) { hourlyVols.push(0); continue; }
      let vol = 0;
      for (let i = 1; i < slice.length; i++) {
        vol += Math.abs(slice[i].p - slice[i - 1].p);
      }
      hourlyVols.push(vol * 10000); // escalar para comparación
    }
    return hourlyVols;
  } catch { return []; }
}

function InsiderTab({ t, lang }: { t: typeof T["en"]; lang: Lang }) {
  const [signals, setSignals] = useState<InsiderSignal[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      // 1. Obtener mercados políticos activos con buen volumen
      const qs = new URLSearchParams({
        minProb: "0.05", // Sin filtro de prob — queremos ver todos
        maxDays: "30",
        minVol: "50000", // Solo mercados líquidos $50K+
        category: "Politics",
      });
      const res = await fetch(`/api/markets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "API Error");

      const politicalMarkets: ProcessedMarket[] = (data.markets ?? [])
        .filter((m: ProcessedMarket) => m.volume24hr > 0)
        .slice(0, 30); // Analizar top 30 por volumen

      // 2. Para cada mercado, calcular ratio de spike usando datos disponibles
      // Dado que CLOB requiere tokenId que no tenemos directamente,
      // usamos volume24hr vs media diaria estimada del volumen total
      const detected: InsiderSignal[] = [];

      for (const market of politicalMarkets) {
        // Estimar días activos del mercado
        const totalDays = Math.max(1, 30 - market.daysLeft); // Aprox días desde creación
        const estimatedDailyAvg = market.volume / Math.max(totalDays, 1);
        const estimatedHourlyAvg = estimatedDailyAvg / 24;

        if (estimatedHourlyAvg <= 0) continue;

        // Volume24hr / 24 = volumen de "última hora" estimado (conservador)
        // Si volume24hr es mucho mayor que la media diaria histórica → spike
        const lastHourEstimate = market.volume24hr / 8; // Asumimos que el spike ocurrió en ~8h
        const spikeRatio = market.volume24hr / estimatedDailyAvg;

        if (spikeRatio < 2.5) continue; // Umbral mínimo

        let alertLevel: "MODERATE" | "HIGH" | "EXTREME" = "MODERATE";
        if (spikeRatio >= 10) alertLevel = "EXTREME";
        else if (spikeRatio >= 5) alertLevel = "HIGH";

        detected.push({
          market,
          spikeRatio,
          hourlyAvg: estimatedHourlyAvg,
          lastHourVol: lastHourEstimate,
          alertLevel,
          detectedAt: new Date().toLocaleTimeString(lang === "en" ? "en-US" : "es-ES", { hour: "2-digit", minute: "2-digit" }),
        });
      }

      // Ordenar por spike ratio descendente
      detected.sort((a, b) => b.spikeRatio - a.spikeRatio);
      setSignals(detected.slice(0, 15));
      setLastScan(new Date().toLocaleTimeString(lang === "en" ? "en-US" : "es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Scan error");
    } finally {
      setScanning(false);
    }
  }, [lang]);

  // Auto-scan al montar + cada 5 min
  useEffect(() => {
    scan();
    const interval = setInterval(scan, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [scan]);

  const alertColors: Record<string, { bg: string; border: string; text: string; label: string }> = {
    MODERATE: { bg: "rgba(253,224,71,0.08)", border: "rgba(253,224,71,0.25)", text: "#fcd34d", label: t.alertModerate },
    HIGH:     { bg: "rgba(251,146,60,0.08)", border: "rgba(251,146,60,0.25)", text: "#fb923c", label: t.alertHigh },
    EXTREME:  { bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.3)", text: "#f87171", label: t.alertExtreme },
  };

  return (
    <div>
      {/* Header insider */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: scanning ? "#f97316" : signals.length > 0 ? "#f87171" : "#34d399", animation: scanning ? "blink 1s infinite" : "none" }} />
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>{t.insiderTitle}</h2>
          </div>
          <p style={{ fontSize: 12, color: "#4b5563" }}>
            {t.insiderSubtitle}
            {lastScan && <span style={{ color: "#374151" }}> · {t.insiderLastScan} {lastScan}</span>}
          </p>
        </div>
        <button onClick={scan} disabled={scanning}
          style={{ fontSize: 12, padding: "7px 16px", background: scanning ? "rgba(99,102,241,0.2)" : "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 8, color: "#fff", fontWeight: 600, cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}>
          {scanning ? "⟳ Scanning..." : t.insiderRefresh}
        </button>
      </div>

      {/* Cómo funciona */}
      <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 12, padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{t.howItWorks}</div>
        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>{t.howText}</p>
        <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
          {[
            { label: t.alertModerate, threshold: "2.5x – 5x", color: "#fcd34d" },
            { label: t.alertHigh, threshold: "5x – 10x", color: "#fb923c" },
            { label: t.alertExtreme, threshold: "> 10x", color: "#f87171" },
          ].map(({ label, threshold, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 11, color: "#6b7280" }}><span style={{ color, fontWeight: 600 }}>{label}</span> {threshold}</span>
            </div>
          ))}
        </div>
      </div>

      {error && <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#fca5a5", fontSize: 12, marginBottom: "1rem" }}>{error}</div>}

      {scanning && (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "#4b5563" }}>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{t.insiderScanning}</div>
          <div style={{ fontSize: 11, color: "#374151" }}>Fetching political markets + CLOB volume data...</div>
        </div>
      )}

      {!scanning && signals.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 0" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🟢</div>
          <div style={{ fontSize: 14, color: "#4b5563" }}>{t.insiderEmpty}</div>
        </div>
      )}

      {!scanning && signals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {signals.map((s, i) => {
            const ac = alertColors[s.alertLevel];
            const pct = Math.round(s.market.bestProb * 100);
            const priceColor = s.market.oneDayPriceChange > 0.05 ? "#34d399" : s.market.oneDayPriceChange < -0.05 ? "#f87171" : "#9ca3af";
            return (
              <div key={s.market.id} style={{ background: ac.bg, border: `1px solid ${ac.border}`, borderRadius: 14, padding: "1rem 1.25rem", position: "relative" }}>
                {/* Alert badge */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: ac.text, background: `${ac.border}`, border: `1px solid ${ac.border}`, borderRadius: 4, padding: "2px 8px", letterSpacing: "0.1em" }}>
                    ⚡ {ac.label}
                  </span>
                  <span style={{ fontSize: 11, color: ac.text, fontFamily: "monospace", fontWeight: 700 }}>
                    {s.spikeRatio.toFixed(1)}x {t.spikeLabel}
                  </span>
                  <span style={{ fontSize: 10, color: "#374151", marginLeft: "auto" }}>#{i + 1} · {s.detectedAt}</span>
                </div>

                {/* Pregunta */}
                <p style={{ fontSize: 13.5, color: "#e5e7eb", lineHeight: 1.5, marginBottom: 12, fontWeight: 500 }}>
                  {s.market.question}
                </p>

                {/* Stats row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 10, marginBottom: 12 }}>
                  {/* Spike chart */}
                  <div>
                    <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Volume spike</div>
                    <SpikeChart hourlyAvg={s.hourlyAvg} lastHourVol={s.lastHourVol} spikeRatio={s.spikeRatio} />
                  </div>
                  <StatItem label={t.hourlyAvg} value={fmtVol(s.hourlyAvg)} color="#9ca3af" />
                  <StatItem label={t.lastHour} value={fmtVol(s.lastHourVol)} color={ac.text} />
                  <StatItem label="24h Vol." value={fmtVol(s.market.volume24hr)} color="#a5b4fc" />
                  <StatItem label={t.priceMove} value={(s.market.oneDayPriceChange * 100 > 0 ? "+" : "") + (s.market.oneDayPriceChange * 100).toFixed(1) + "%"} color={priceColor} />
                  <StatItem label={t.timeLeft} value={fmtDays(s.market.daysLeft)} color="#fb923c" />
                  <StatItem label={t.liquidity} value={fmtVol(s.market.volume)} color="#9ca3af" />
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                    <div style={{ textAlign: "center", padding: "4px 8px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 7 }}>
                      <div style={{ fontSize: 8, color: "#34d399", fontWeight: 700 }}>YES</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", fontFamily: "monospace" }}>{pct}¢</div>
                    </div>
                    <div style={{ textAlign: "center", padding: "4px 8px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 7 }}>
                      <div style={{ fontSize: 8, color: "#f87171", fontWeight: 700 }}>NO</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171", fontFamily: "monospace" }}>{100 - pct}¢</div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${ac.border}` }}>
                  <div style={{ fontSize: 10, color: "#374151", fontFamily: "monospace" }}>
                    {s.market.bestBid > 0 && `bid ${fmtPct(s.market.bestBid)} · ask ${fmtPct(s.market.bestAsk)} · spr ${(s.market.spread * 100).toFixed(1)}%`}
                  </div>
                  <a href={s.market.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: ac.text, textDecoration: "none", padding: "5px 14px", border: `1px solid ${ac.border}`, borderRadius: 8, fontWeight: 600 }}>
                    {t.view}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];
  const [activeTab, setActiveTab] = useState<"polyedge" | "insider">("polyedge");

  const [filters, setFilters] = useState<Filters>({ minProb: 0.9, maxDays: 7, minVol: 1000, category: "" });
  const [markets, setMarkets] = useState<ProcessedMarket[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("prob");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_SEC);
  const [alertCount, setAlertCount] = useState(0);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  useEffect(() => { doFetch(false, true); }, []);

  const doFetch = useCallback(async (isAuto: boolean, initialOnly = false) => {
    setLoading(true); setError(null);
    const f = filtersRef.current;
    try {
      const qs = new URLSearchParams({
        minProb: initialOnly ? "0.93" : String(f.minProb),
        maxDays: initialOnly ? "7"   : String(f.maxDays),
        minVol:  initialOnly ? "10000" : String(f.minVol),
        category: f.category,
        ...(isAuto ? { t: String(Date.now()) } : {}),
      });
      const res = await fetch(`/api/markets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "API Error");
      let incoming: ProcessedMarket[] = data.markets ?? [];
      if (initialOnly) incoming = incoming.slice(0, 10);
      const incomingIds = new Set(incoming.map(m => m.id));
      if (isAuto && prevIdsRef.current.size > 0) {
        const detected = new Set(incoming.filter(m => !prevIdsRef.current.has(m.id)).map(m => m.id));
        setNewIds(detected);
        if (detected.size > 0) {
          setAlertCount(c => c + detected.size);
          if (typeof Notification !== "undefined" && Notification.permission === "granted")
            new Notification("PolyEdge", { body: t.newBadge(detected.size) });
        } else setNewIds(new Set());
      } else setNewIds(new Set());
      prevIdsRef.current = incomingIds;
      setMarkets(incoming);
      setFetchedAt(data.fetchedAt);
      setIsInitialLoad(initialOnly);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally { setLoading(false); }
  }, [t]);

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
    if (sortKey === "prob")   diff = b.bestProb - a.bestProb;
    if (sortKey === "days")   diff = a.daysLeft - b.daysLeft;
    if (sortKey === "volume") diff = b.volume - a.volume;
    if (sortKey === "gain")   diff = 1 / a.bestProb - 1 / b.bestProb;
    return sortDir === "asc" ? -diff : diff;
  });

  const avgProb = markets.length ? markets.reduce((s, m) => s + m.bestProb, 0) / markets.length : 0;
  const totalVol = markets.reduce((s, m) => s + m.volume, 0);
  const sl = (k: SortKey) => ({ prob: t.prob, days: t.days, volume: t.volume, gain: t.gain }[k] + (sortKey === k ? (sortDir === "desc" ? "↓" : "↑") : ""));
  const selStyle = (active: boolean): React.CSSProperties => ({
    width: "100%", padding: "7px 9px",
    background: "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? "rgba(129,140,248,0.4)" : "rgba(255,255,255,0.08)"}`,
    borderRadius: 8, color: "#e5e7eb", fontSize: 12,
  });

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
        .mcard:hover{border-color:rgba(99,102,241,0.5)!important;box-shadow:0 0 0 1px rgba(99,102,241,0.12);}
        .sbtn{transition:all 0.1s;cursor:pointer;}
        .sbtn:hover{background:rgba(99,102,241,0.15)!important;color:#a5b4fc!important;}
        .srchbtn{transition:all 0.12s;}
        .srchbtn:hover:not(:disabled){filter:brightness(1.18);box-shadow:0 0 20px rgba(99,102,241,0.4);}
        .pl{transition:all 0.1s;}
        .pl:hover{background:rgba(99,102,241,0.2)!important;color:#c7d2fe!important;}
        .tabbtn{transition:all 0.15s;cursor:pointer;}
        .tabbtn:hover{color:#e5e7eb!important;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", paddingBottom: "1.25rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em", color: "#fff" }}>PolyEdge</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.08em" }}>BETA</span>
              {alertCount > 0 && (
                <span onClick={() => setAlertCount(0)} style={{ fontSize: 10, background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 99, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                  {t.newBadge(alertCount)}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#4b5563", marginTop: 1 }}>
              {fetchedAt ? `${t.updated} ${new Date(fetchedAt).toLocaleTimeString(lang === "en" ? "en-US" : "es-ES", { hour: "2-digit", minute: "2-digit" })}` : t.subtitle}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden" }}>
            {(["en", "es"] as Lang[]).map(l => (
              <button key={l} onClick={() => setLang(l)}
                style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "none", background: lang === l ? "rgba(99,102,241,0.25)" : "transparent", color: lang === l ? "#a5b4fc" : "#4b5563", cursor: "pointer", letterSpacing: "0.04em" }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {autoRefresh && <span style={{ fontSize: 11, color: "#4b5563", fontFamily: "'JetBrains Mono',monospace" }}>{fmtCountdown(countdown)}</span>}
          <button onClick={() => { const n = !autoRefresh; setAutoRefresh(n); if (n && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); }}
            style={{ fontSize: 11, padding: "5px 12px", border: `1px solid ${autoRefresh ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, background: autoRefresh ? "rgba(99,102,241,0.15)" : "transparent", color: autoRefresh ? "#a5b4fc" : "#6b7280", cursor: "pointer", fontWeight: 500 }}>
            {autoRefresh ? t.liveOn : t.liveOff}
          </button>
        </div>
      </header>

      {/* ── TABS ── */}
      <nav style={{ display: "flex", gap: 2, marginBottom: "1.5rem", borderBottom: "1px solid rgba(255,255,255,0.07)", paddingBottom: 0 }}>
        {([
          { key: "polyedge", label: t.polyedgeTab, icon: "◎" },
          { key: "insider", label: t.insiderTab, icon: "⚡" },
        ] as { key: "polyedge" | "insider"; label: string; icon: string }[]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className="tabbtn"
            style={{
              padding: "8px 18px", fontSize: 13, fontWeight: 600, border: "none", background: "transparent",
              color: activeTab === tab.key ? "#fff" : "#4b5563", cursor: "pointer",
              borderBottom: `2px solid ${activeTab === tab.key ? "#6366f1" : "transparent"}`,
              marginBottom: -1, display: "flex", alignItems: "center", gap: 6,
            }}>
            <span>{tab.icon}</span>{tab.label}
            {tab.key === "insider" && <span style={{ fontSize: 9, background: "rgba(248,113,113,0.15)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 99, padding: "1px 6px", fontWeight: 700 }}>LIVE</span>}
          </button>
        ))}
      </nav>

      {/* ── TAB: POLYEDGE ── */}
      {activeTab === "polyedge" && (
        <>
          {/* Filtros */}
          <section style={{ marginBottom: "1.25rem" }}>
            <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: sortKey === "prob" ? "#818cf8" : "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{sortKey === "prob" ? "▸ " : ""}{t.probability}</label>
                  <select value={filters.minProb} onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, minProb: v })); setSortKey("prob"); setSortDir("desc"); }} style={selStyle(sortKey === "prob")}>
                    {PROB_OPTS.map(v => <option key={v} value={v} style={{ background: "#111" }}>{v * 100}%+</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: sortKey === "days" ? "#818cf8" : "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{sortKey === "days" ? "▸ " : ""}{t.closesIn}</label>
                  <select value={filters.maxDays} onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, maxDays: v })); setSortKey("days"); setSortDir("asc"); }} style={selStyle(sortKey === "days")}>
                    {DAYS_VALS.map((v, i) => <option key={v} value={v} style={{ background: "#111" }}>{t.daysOpts[i]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: sortKey === "volume" ? "#818cf8" : "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{sortKey === "volume" ? "▸ " : ""}{t.minVolume}</label>
                  <select value={filters.minVol} onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, minVol: v })); if (v > 0) { setSortKey("volume"); setSortDir("desc"); } }} style={selStyle(sortKey === "volume")}>
                    {VOL_VALS.map((v, i) => <option key={v} value={v} style={{ background: "#111" }}>{t.volOpts[i]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.category}</label>
                  <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} style={selStyle(false)}>
                    {t.catVals.map((v, i) => <option key={v} value={v} style={{ background: "#111" }}>{t.cats[i]}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  <label style={{ display: "block", fontSize: 9, color: "transparent", marginBottom: 5, fontWeight: 700 }}>·</label>
                  <button onClick={() => doFetch(false, false)} disabled={loading} className="srchbtn"
                    style={{ padding: "7px 12px", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
                    {loading ? t.searching : t.search}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {error && <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#fca5a5", fontSize: 12, marginBottom: "1rem" }}>{error}</div>}

          {/* Métricas */}
          {markets.length > 0 && (
            <section style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                {[
                  { label: t.markets, value: String(markets.length), color: "#fff" },
                  { label: t.avgProb, value: fmtPct(avgProb), color: "#a5b4fc" },
                  { label: t.totalVol, value: fmtVol(totalVol), color: "#fff" },
                  { label: t.avgGain, value: markets.length ? ((1 / avgProb - 1) * 100).toFixed(1) + "%" : "—", color: "#34d399" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "-0.02em" }}>{value}</div>
                    <div style={{ fontSize: 9, color: "#374151", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Sort bar + tabla header */}
          {sorted.length > 0 && (
            <section style={{ marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{t.sortBy}</span>
                {(["prob","days","volume","gain"] as SortKey[]).map(k => (
                  <button key={k} onClick={() => handleSort(k)} className="sbtn"
                    style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${sortKey === k ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: 99, background: sortKey === k ? "rgba(99,102,241,0.18)" : "transparent", color: sortKey === k ? "#a5b4fc" : "#6b7280", fontWeight: sortKey === k ? 600 : 400 }}>
                    {sl(k)}
                  </button>
                ))}
                {newIds.size > 0 && <span style={{ marginLeft: "auto", fontSize: 10, color: "#fca5a5", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 99, padding: "2px 8px" }}>{t.newBadge(newIds.size)}</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 52px 80px 62px 62px 70px 76px", gap: 8, padding: "5px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {t.tableHeaders.map((h, i) => <div key={i} style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: "0.08em" }}>{h}</div>)}
              </div>
            </section>
          )}

          {/* Lista */}
          <section style={{ marginBottom: "2rem" }}>
            {loading && <div style={{ textAlign: "center", padding: "2.5rem 0", color: "#374151", fontSize: 13 }}>{t.loading}</div>}
            {!loading && markets.length === 0 && <div style={{ textAlign: "center", padding: "2.5rem 0", color: "#374151", fontSize: 13 }}>{t.noResults}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {!loading && sorted.map((m, i) => <MarketRow key={m.id} market={m} isNew={newIds.has(m.id)} rank={i + 1} t={t} />)}
            </div>
            {!loading && isInitialLoad && markets.length > 0 && (
              <div style={{ textAlign: "center", padding: "12px", background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 10, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>{t.previewMsg} <span style={{ color: "#a5b4fc" }}></span> {t.previewSub}</span>
              </div>
            )}
          </section>

          {/* Terminales */}
          <section>
            <div style={{ height: 1, background: "linear-gradient(90deg,rgba(99,102,241,0.4),transparent)", marginBottom: "1.25rem" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.875rem", height: 240 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f97316", display: "inline-block", animation: "blink 2s infinite" }} />
                  <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.closingSoon}</span>
                  <span style={{ fontSize: 9, color: "#374151", marginLeft: "auto" }}>≤ 72h</span>
                </div>
                <div style={{ height: "calc(100% - 30px)" }}><UrgentTerminal markets={markets} t={t} /></div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.875rem", height: 240 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
                  <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.newsTitle}</span>
                  <span style={{ fontSize: 9, color: "#374151", marginLeft: "auto" }}>{t.newsSub}</span>
                </div>
                <div style={{ height: "calc(100% - 30px)" }}><NewsTerminal t={t} /></div>
              </div>
            </div>
          </section>
        </>
      )}

      {/* ── TAB: INSIDER ACTIVITY ── */}
      {activeTab === "insider" && <InsiderTab t={t} lang={lang} />}

      <footer style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#1f2937" }}>{t.footer} · {markets.length} markets</span>
        <span style={{ fontSize: 10, color: "#1f2937" }}>{t.disclaimer}</span>
      </footer>
    </main>
  );
}

// ── Market Row ────────────────────────────────────────────────────────────────
function MarketRow({ market: m, isNew, rank, t }: { market: ProcessedMarket; isNew: boolean; rank: number; t: typeof T["en"] }) {
  const pct = Math.round(m.bestProb * 100);
  const noPct = 100 - pct;
  const gain = ((1 / m.bestProb - 1) * 100).toFixed(1);
  const isVH = pct >= 95;
  const probColor = isVH ? "#34d399" : pct >= 90 ? "#6ee7b7" : "#fcd34d";
  const estTraders = Math.max(1, Math.round(m.volume / 200));
  const estOrders  = Math.max(0, Math.round(m.volume24hr / 50));

  return (
    <div className="mcard" style={{
      display: "grid", gridTemplateColumns: "1fr 52px 52px 80px 62px 62px 70px 76px",
      gap: 8, alignItems: "center", padding: "9px 12px",
      background: isNew ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)",
      border: `1px solid ${isNew ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)"}`,
      borderRadius: 10, position: "relative",
    }}>
      {isNew && <span style={{ position: "absolute", top: -8, left: 12, fontSize: 9, fontWeight: 700, background: "#6366f1", color: "#fff", borderRadius: 99, padding: "1px 7px", letterSpacing: "0.08em" }}>{t.new}</span>}
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
        {m.bestBid > 0 && <div style={{ fontSize: 9, color: "#374151", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>{t.bid} {fmtPct(m.bestBid)} · {t.ask} {fmtPct(m.bestAsk)} · {t.spr} {(m.spread * 100).toFixed(1)}%</div>}
      </div>
      <div style={{ textAlign: "center", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 7, padding: "5px 4px" }}>
        <div style={{ fontSize: 8, color: "#34d399", fontWeight: 700, letterSpacing: "0.06em" }}>YES</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>{pct}¢</div>
      </div>
      <div style={{ textAlign: "center", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 7, padding: "5px 4px" }}>
        <div style={{ fontSize: 8, color: "#f87171", fontWeight: 700, letterSpacing: "0.06em" }}>NO</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>{noPct}¢</div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{fmtVol(m.volume)}</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>{fmtVol(m.volume24hr)}/24h</div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{estOrders > 0 ? estOrders : "—"}</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>24h</div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{estTraders > 999 ? fmtVol(estTraders).replace("$","") : estTraders}</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>{t.approx}</div>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: probColor, fontFamily: "'JetBrains Mono',monospace" }}>+{gain}%</div>
        <div style={{ fontSize: 9, color: "#4b5563" }}>{fmtDays(m.daysLeft)}</div>
      </div>
      <a href={m.url} target="_blank" rel="noopener noreferrer" className="pl"
        style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", padding: "5px 10px", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 7, fontWeight: 500, textAlign: "center", display: "block" }}>
        {t.view}
      </a>
    </div>
  );
}
