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
  if (d < 0) return "resolving";
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
  { value: "", label: "All" }, { value: "Sports", label: "Sports" },
  { value: "Crypto", label: "Crypto" }, { value: "Politics", label: "Politics" },
  { value: "Weather", label: "Weather" }, { value: "Finance", label: "Finance" },
  { value: "Entertainment", label: "Entertainment" },
  { value: "Technology", label: "Technology" }, { value: "World", label: "World" },
];
const PROB_OPTS = [0.80, 0.85, 0.90, 0.93, 0.95, 0.97];
const DAYS_VALS = [0.5, 1, 2, 3, 7, 14, 30];
const DAYS_LABELS = ["≤ 12h","≤ 1 day","≤ 2 days","≤ 3 days","≤ 7 days","≤ 14 days","≤ 30 days"];
const VOL_VALS = [0, 1000, 10000, 50000, 100000];
const VOL_LABELS = ["Any","$1K+","$10K+","$50K+","$100K+"];



interface RewardMarket {
  id: string; question: string; url: string; category: string;
  rewardsDailyRate: number; rewardsMinSize: number; rewardsMaxSpread: number;
  competitive: number; spread: number; liquidity: number;
  volume24hr: number; daysLeft: number; bestBid: number; bestAsk: number;
  opportunityScore: number;
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect width="32" height="32" rx="8" fill="url(#lg)" />
      <path d="M8 20 L13 14 L19 20 L23 16 L24 22 L8 22 Z" fill="rgba(255,255,255,0.1)" />
      <path d="M8 20 L13 14 L19 20 L23 16" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
  const pts = Array.from({ length: 10 }, (_, i) =>
    start + (end - start) * (i / 9) + Math.sin(i * 2.1 + prob * 8) * 0.01
  );
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

// ── SpikeChart ────────────────────────────────────────────────────────────────
function SpikeChart({ spikeRatio }: { spikeRatio: number }) {
  const color = spikeRatio >= 10 ? "#f87171" : spikeRatio >= 5 ? "#fb923c" : "#fcd34d";
  const bars = Array.from({ length: 8 }, (_, i) => i === 7 ? 100 : 15 + Math.abs(Math.sin(i * 1.7)) * 20);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 32, width: 80 }}>
      {bars.map((h, i) => (
        <div key={i} style={{ flex: 1, borderRadius: 2, background: i === 7 ? color : "rgba(255,255,255,0.1)", height: `${h}%` }} />
      ))}
    </div>
  );
}

// ── News Terminal ─────────────────────────────────────────────────────────────
function NewsTerminal() {
  const [items, setItems] = useState<{ title: string; time: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const feeds = [
      "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffinance.yahoo.com%2Frss%2Ftopfinstories&count=20",
      "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Ffinance.yahoo.com%2Frss%2Fnews&count=20",
    ];
    const fallback = [
      { title: "S&P 500 drops amid Trump tariff escalation", time: "11:20", url: "https://finance.yahoo.com" },
      { title: "Fed holds rates — Powell rules out imminent cuts", time: "10:55", url: "https://finance.yahoo.com" },
      { title: "Bitcoin falls below $75,000 for first time in months", time: "10:30", url: "https://finance.yahoo.com" },
      { title: "Nvidia posts record revenue despite chip restrictions", time: "10:05", url: "https://finance.yahoo.com" },
      { title: "Gold hits $3,100/oz as investors flee to safety", time: "09:40", url: "https://finance.yahoo.com" },
      { title: "Apple maintains guidance despite China exposure", time: "09:15", url: "https://finance.yahoo.com" },
      { title: "JP Morgan raises recession probability to 60%", time: "08:50", url: "https://finance.yahoo.com" },
    ];
    const tryFeed = (idx: number) => {
      if (idx >= feeds.length) { setItems(fallback); setLoading(false); return; }
      fetch(feeds[idx])
        .then(r => r.json())
        .then(d => {
          const feed = d.items ?? [];
          if (!feed.length) { tryFeed(idx + 1); return; }
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
      {loading ? <div style={{ color: "#4b5563", fontSize: 12 }}>Loading news...</div>
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
function UrgentTerminal({ markets }: { markets: ProcessedMarket[] }) {
  const urgent = [...markets].filter(m => m.daysLeft >= 0 && m.daysLeft <= 3).sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 15);
  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {urgent.length === 0
        ? <div style={{ color: "#4b5563", fontSize: 12 }}>Search markets to see ones closing soon.</div>
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
interface HistoricalSpike {
  market: any;
  spikeRatio24h: number;
  spikeRatio1w: number;
  priceChange24h: number;
  priceChange1w: number;
  priceChange1m: number;
  vol24h: number;
  vol1w: number;
  vol1m: number;
  dailyAvg: number;
  alertLevel: "MODERATE" | "HIGH" | "EXTREME";
  periods: { label: string; ratio: number; priceChg: number; color: string }[];
}

function InsiderTab({ allMarkets }: { allMarkets: ProcessedMarket[] }) {
  const [signals, setSignals] = useState<HistoricalSpike[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"live" | "history">("live");

  const scan = useCallback(async () => {
    setScanning(true); setError(null);
    try {
      // Llamar directamente a Gamma API para obtener volume1wk, volume1mo completos
      // Necesitamos estos campos para calcular spikes históricos reales
      const pages = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          fetch(
            `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100&offset=${i * 100}&order=volume_24hr&ascending=false`,
            { headers: { Accept: "application/json" }, cache: "no-store" }
          ).then(r => r.ok ? r.json() : []).catch(() => [])
        )
      );
      const allMkts: any[] = pages.flat().map((m: any) => ({
        ...m,
        // Normalizar campos para compatibilidad
        bestProb: (() => { try { const p = JSON.parse(m.outcomePrices ?? "[]").map(Number); return p.length ? Math.max(...p) : 0.5; } catch { return 0.5; } })(),
        volume: parseFloat(m.volume ?? "0"),
        volume24hr: parseFloat(m.volume24hr ?? "0"),
        volume1wk: parseFloat(m.volume1wk ?? "0"),
        volume1mo: parseFloat(m.volume1mo ?? "0"),
        oneDayPriceChange: m.oneDayPriceChange ?? 0,
        oneWeekPriceChange: m.oneWeekPriceChange ?? 0,
        oneMonthPriceChange: m.oneMonthPriceChange ?? 0,
        category: m.events?.[0]?.tags?.[0]?.label ?? "",
        url: m.events?.[0]?.slug ? \`https://polymarket.com/event/\${m.events[0].slug}\` : \`https://polymarket.com/event/\${m.slug ?? ""}\`,
        daysLeft: m.endDate ? (new Date(m.endDate).getTime() - Date.now()) / 86400000 : 999,
        bestBid: m.bestBid ?? 0,
        bestAsk: m.bestAsk ?? 0,
        spread: m.spread ?? 0,
      })).filter((m: any) => m.volume24hr > 5000);

      // Deduplicar
      const seen = new Set<string>();
      const unique = allMkts.filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });

      const detected: HistoricalSpike[] = [];

      for (const market of unique) {
        const vol24  = market.volume24hr ?? 0;
        const vol1w  = market.volume1wk ?? (vol24 * 7);
        const vol1m  = market.volume1mo ?? (vol24 * 30);
        if (vol24 <= 0 || vol1m <= 0) continue;

        // Media diaria del mes (excluyendo las últimas 24h para no sesgar)
        const dailyAvg = Math.max(1, (vol1m - vol24) / 29);

        // Ratio de spike: cuántas veces el volumen de hoy supera la media diaria
        const spike24h = vol24 / dailyAvg;
        // Ratio semanal: vol esta semana vs media semanal del mes
        const weeklyAvg = dailyAvg * 7;
        const spike1w = vol1w / Math.max(1, weeklyAvg);

        // Solo incluir si hay spike real en 24h O en semana
        if (spike24h < 2 && spike1w < 1.8) continue;

        const priceChg24h = market.oneDayPriceChange ?? 0;
        const priceChg1w  = market.oneWeekPriceChange ?? 0;
        const priceChg1m  = market.oneMonthPriceChange ?? 0;

        // Nivel de alerta basado en el spike más alto
        const maxSpike = Math.max(spike24h, spike1w);
        let alertLevel: "MODERATE" | "HIGH" | "EXTREME" = "MODERATE";
        if (maxSpike >= 8) alertLevel = "EXTREME";
        else if (maxSpike >= 4) alertLevel = "HIGH";

        // Períodos con datos históricos
        const periods = [
          { label: "24h spike", ratio: spike24h, priceChg: priceChg24h * 100, color: spike24h >= 4 ? "#f87171" : spike24h >= 2 ? "#fb923c" : "#fcd34d" },
          { label: "7d spike",  ratio: spike1w,  priceChg: priceChg1w  * 100, color: spike1w  >= 4 ? "#f87171" : spike1w  >= 2 ? "#fb923c" : "#fcd34d" },
          { label: "30d move",  ratio: vol1m / Math.max(1, dailyAvg * 30), priceChg: priceChg1m * 100, color: "#a5b4fc" },
        ];

        detected.push({
          market,
          spikeRatio24h: spike24h,
          spikeRatio1w:  spike1w,
          priceChange24h: priceChg24h,
          priceChange1w:  priceChg1w,
          priceChange1m:  priceChg1m,
          vol24h: vol24, vol1w, vol1m,
          dailyAvg,
          alertLevel,
          periods,
        });
      }

      // Ordenar por spike 24h descendente
      detected.sort((a, b) => b.spikeRatio24h - a.spikeRatio24h);
      setSignals(detected.slice(0, 30));
      setLastScan(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Scan error"); }
    finally { setScanning(false); }
  }, []);

  useEffect(() => { scan(); const i = setInterval(scan, 5 * 60 * 1000); return () => clearInterval(i); }, [scan]);

  const alertColors: Record<string, { bg: string; border: string; text: string }> = {
    MODERATE: { bg: "rgba(253,224,71,0.05)", border: "rgba(253,224,71,0.18)", text: "#fcd34d" },
    HIGH:     { bg: "rgba(251,146,60,0.06)", border: "rgba(251,146,60,0.2)",  text: "#fb923c" },
    EXTREME:  { bg: "rgba(248,113,113,0.07)", border: "rgba(248,113,113,0.25)", text: "#f87171" },
  };

  // Filtrar: live = spike fuerte hoy; history = spikes pasados (semana/mes)
  const liveSignals    = signals.filter(s => s.spikeRatio24h >= 2);
  const historySignals = signals.filter(s => s.spikeRatio1w >= 1.8 || s.priceChange1m !== 0);

  const displayed = view === "live" ? liveSignals : historySignals;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.25rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: scanning ? "#f97316" : liveSignals.length > 0 ? "#f87171" : "#34d399", animation: "blink 2s infinite" }} />
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>Insider Activity</h2>
          </div>
          <p style={{ fontSize: 12, color: "#4b5563" }}>
            Volumen anormal detectado · {lastScan && <span style={{ color: "#374151" }}>Último scan: {lastScan}</span>}
          </p>
        </div>
        <button onClick={scan} disabled={scanning} style={{ fontSize: 12, padding: "7px 16px", background: scanning ? "rgba(99,102,241,0.2)" : "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 8, color: "#fff", fontWeight: 600, cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}>
          {scanning ? "⟳ Scanning..." : "Scan now"}
        </button>
      </div>

      {/* Tabs live / histórico */}
      <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem" }}>
        {([
          { k: "live" as const,    l: "⚡ En vivo",  count: liveSignals.length },
          { k: "history" as const, l: "📊 Histórico", count: historySignals.length },
        ]).map(({ k, l, count }) => (
          <button key={k} onClick={() => setView(k)} className="sbtn"
            style={{ fontSize: 12, padding: "6px 16px", border: `1px solid ${view === k ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.08)"}`, borderRadius: 8, background: view === k ? "rgba(99,102,241,0.15)" : "transparent", color: view === k ? "#a5b4fc" : "#6b7280", fontWeight: view === k ? 600 : 400, display: "flex", alignItems: "center", gap: 6 }}>
            {l}
            <span style={{ fontSize: 10, background: "rgba(255,255,255,0.08)", borderRadius: 99, padding: "1px 6px" }}>{count}</span>
          </button>
        ))}
      </div>

      {/* Explicación */}
      <div style={{ background: "rgba(99,102,241,0.04)", border: "1px solid rgba(99,102,241,0.12)", borderRadius: 10, padding: "10px 14px", marginBottom: "1.25rem", fontSize: 11, color: "#6b7280", lineHeight: 1.6 }}>
        {view === "live"
          ? "⚡ Mercados donde el volumen de las últimas 24h supera 2x la media diaria del mes. Puede indicar entrada de capital antes de un evento."
          : "📊 Histórico de mercados con spikes de volumen en la última semana o mes, con movimiento de precio asociado."}
      </div>

      {error && <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#fca5a5", fontSize: 12, marginBottom: "1rem" }}>{error}</div>}
      {scanning && <div style={{ textAlign: "center", padding: "3rem 0", color: "#4b5563", fontSize: 13 }}>Escaneando mercados...</div>}
      {!scanning && displayed.length === 0 && (
        <div style={{ textAlign: "center", padding: "3rem 0" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🟢</div>
          <div style={{ fontSize: 14, color: "#4b5563" }}>Sin señales detectadas en este período.</div>
        </div>
      )}

      {!scanning && displayed.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {displayed.map((s, i) => {
            const ac = alertColors[s.alertLevel];
            const pct = Math.round((s.market.bestProb ?? 0.5) * 100);
            return (
              <div key={s.market.id} style={{ background: ac.bg, border: `1px solid ${ac.border}`, borderRadius: 12, padding: "1rem 1.25rem" }}>
                {/* Top */}
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: ac.text, border: `1px solid ${ac.border}`, borderRadius: 4, padding: "2px 8px", letterSpacing: "0.08em" }}>
                        ⚡ {s.alertLevel}
                      </span>
                      <span style={{ fontSize: 11, color: ac.text, fontFamily: "monospace", fontWeight: 700 }}>
                        {s.spikeRatio24h.toFixed(1)}x spike 24h
                      </span>
                      {s.market.category && <span style={{ fontSize: 9, color: "#4b5563", background: "rgba(255,255,255,0.05)", borderRadius: 3, padding: "1px 5px" }}>{s.market.category}</span>}
                      <span style={{ fontSize: 9, color: "#374151", marginLeft: "auto" }}>#{i + 1}</span>
                    </div>
                    <p style={{ fontSize: 13, color: "#e5e7eb", lineHeight: 1.5, fontWeight: 500 }}>{s.market.question}</p>
                  </div>
                  {/* YES/NO */}
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <div style={{ textAlign: "center", padding: "4px 10px", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 7 }}>
                      <div style={{ fontSize: 8, color: "#34d399", fontWeight: 700 }}>YES</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", fontFamily: "monospace" }}>{pct}¢</div>
                    </div>
                    <div style={{ textAlign: "center", padding: "4px 10px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 7 }}>
                      <div style={{ fontSize: 8, color: "#f87171", fontWeight: 700 }}>NO</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171", fontFamily: "monospace" }}>{100 - pct}¢</div>
                    </div>
                  </div>
                </div>

                {/* Períodos históricos */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, padding: "10px 0", borderTop: `1px solid ${ac.border}`, borderBottom: `1px solid ${ac.border}`, marginBottom: 10 }}>
                  {s.periods.map(p => (
                    <div key={p.label} style={{ background: "rgba(0,0,0,0.15)", borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{p.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: p.color, fontFamily: "monospace" }}>{p.ratio.toFixed(1)}x</div>
                      <div style={{ fontSize: 10, color: p.priceChg > 0 ? "#34d399" : p.priceChg < 0 ? "#f87171" : "#4b5563", fontFamily: "monospace", marginTop: 2 }}>
                        {p.priceChg > 0 ? "+" : ""}{p.priceChg.toFixed(1)}% precio
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stats */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 8, marginBottom: 10 }}>
                  {[
                    { label: "Vol. 24h",   value: fmtVol(s.vol24h),   color: ac.text },
                    { label: "Vol. 7d",    value: fmtVol(s.vol1w),    color: "#9ca3af" },
                    { label: "Vol. 30d",   value: fmtVol(s.vol1m),    color: "#9ca3af" },
                    { label: "Media/día",  value: fmtVol(s.dailyAvg), color: "#374151" },
                    { label: "Liquidez",   value: fmtVol(s.market.volume), color: "#9ca3af" },
                    { label: "Cierre",     value: fmtDays(s.market.daysLeft), color: "#fb923c" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 10, color: "#374151", fontFamily: "monospace" }}>
                    {s.market.bestBid > 0 && `bid ${fmtPct(s.market.bestBid)} · ask ${fmtPct(s.market.bestAsk)} · spr ${(s.market.spread * 100).toFixed(1)}%`}
                  </div>
                  <a href={s.market.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: ac.text, textDecoration: "none", padding: "5px 14px", border: `1px solid ${ac.border}`, borderRadius: 8, fontWeight: 600 }}>
                    Ver mercado →
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

// ── Rewards Tab ───────────────────────────────────────────────────────────────
function RewardsTab() {
  const [rewards, setRewards] = useState<RewardMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Llamada a nuestro proxy backend — resuelve CORS con Polymarket
      const res = await fetch("/api/rewards", { cache: "no-store" });
      if (!res.ok) throw new Error("API error " + res.status);
      const data = await res.json();
      const markets: RewardMarket[] = (data.markets ?? []).map((m: any) => ({
        ...m,
        opportunityScore: m.farmingScore ?? 0,
      }));
      setRewards(markets);
      setFetchedAt(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error loading rewards"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const sorted = rewards; // ya ordenado de mejor a peor al cargar

  const compLabel = (c: number) => c < 0.85 ? "Low" : c < 0.95 ? "Medium" : "High";
  const compColor = (c: number) => c < 0.85 ? "#34d399" : c < 0.95 ? "#fcd34d" : "#f87171";
  const scoreColor = (s: number) => s >= 55 ? "#34d399" : s >= 35 ? "#fcd34d" : "#9ca3af";
  const scoreBg    = (s: number) => s >= 55 ? "rgba(52,211,153,0.05)" : s >= 35 ? "rgba(253,224,71,0.04)" : "rgba(255,255,255,0.02)";
  const scoreBdr   = (s: number) => s >= 55 ? "rgba(52,211,153,0.18)" : s >= 35 ? "rgba(253,224,71,0.12)" : "rgba(255,255,255,0.05)";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 20 }}>💎</span>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>Rewards & Incentives</h2>
          </div>
          <p style={{ fontSize: 12, color: "#4b5563" }}>Active CLOB liquidity rewards · Sorted by opportunity score{fetchedAt && <span style={{ color: "#374151" }}> · Updated {fetchedAt}</span>}</p>
        </div>
        <button onClick={load} disabled={loading} style={{ fontSize: 12, padding: "7px 16px", background: loading ? "rgba(99,102,241,0.2)" : "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 8, color: "#fff", fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
          {loading ? "⟳ Loading..." : "↻ Refresh"}
        </button>
      </div>

      <div style={{ background: "rgba(52,211,153,0.04)", border: "1px solid rgba(52,211,153,0.12)", borderRadius: 12, padding: "1rem", marginBottom: "1.25rem" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#34d399", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>How CLOB rewards work</div>
        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.65, marginBottom: 10 }}>
          Polymarket pays market makers who keep resting orders within <strong style={{ color: "#d1d5db" }}>Max Spread</strong> with orders above <strong style={{ color: "#d1d5db" }}>Min Size</strong>. The <strong style={{ color: "#d1d5db" }}>Daily Rate</strong> is the real USDC paid per day from the reward pool — split proportionally among qualifying LPs. Lower competition = larger share for you.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
          {[
            { label: "🎯 Opportunity Score", desc: "High reward + low competition + spread room = best score", color: "#34d399" },
            { label: "💰 Daily Rate", desc: "Real USDC paid daily from clobRewards. Min $50 filter applied.", color: "#a5b4fc" },
            { label: "📊 Competition", desc: "Polymarket competitive score. Lower = easier to earn rewards.", color: "#fb923c" },
          ].map(({ label, desc, color }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 10, color: "#4b5563", lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {error && <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#fca5a5", fontSize: 12, marginBottom: "1rem" }}>{error}</div>}

      {loading && <div style={{ textAlign: "center", padding: "3rem 0", color: "#374151", fontSize: 13 }}>Scanning markets for active rewards...</div>}
      {!loading && sorted.length === 0 && <div style={{ textAlign: "center", padding: "3rem 0", color: "#374151", fontSize: 13 }}>No markets found with active rewards.</div>}

      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((m, i) => {
            const sc = m.opportunityScore;
            const cc = compColor(m.competitive);
            const cl = compLabel(m.competitive);
            const spreadRoom = Math.max(0, m.rewardsMaxSpread - m.spread);
            const canEarn = m.spread <= m.rewardsMaxSpread;
            return (
              <div key={m.id} style={{ background: scoreBg(sc), border: `1px solid ${scoreBdr(sc)}`, borderRadius: 14, padding: "1rem 1.25rem" }} className="mcard">
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                  <div style={{ flexShrink: 0, width: 54, height: 54, borderRadius: 12, background: "rgba(0,0,0,0.25)", border: `1px solid ${scoreBdr(sc)}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: scoreColor(sc), fontFamily: "monospace", lineHeight: 1 }}>{sc}</div>
                    <div style={{ fontSize: 7, color: scoreColor(sc), opacity: 0.7, fontWeight: 700, letterSpacing: "0.05em" }}>SCORE</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 9, color: "#374151", fontFamily: "monospace" }}>#{i + 1}</span>
                      {m.category && <span style={{ fontSize: 9, color: "#4b5563", background: "rgba(255,255,255,0.05)", borderRadius: 3, padding: "1px 5px" }}>{m.category}</span>}
                      <span style={{ fontSize: 9, fontWeight: 700, color: cc, border: `1px solid ${cc}30`, borderRadius: 3, padding: "1px 6px" }}>{cl} competition</span>
                      {!canEarn && <span style={{ fontSize: 9, fontWeight: 700, color: "#f87171", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 3, padding: "1px 6px" }}>⚠ spread too wide</span>}
                    </div>
                    <p style={{ fontSize: 13, color: "#e5e7eb", lineHeight: 1.5, fontWeight: 500 }}>{m.question}</p>
                  </div>
                  <div style={{ flexShrink: 0, textAlign: "right" }}>
                    <div style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 2 }}>Daily reward</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "#34d399", fontFamily: "monospace", lineHeight: 1 }}>${m.rewardsDailyRate.toLocaleString()}</div>
                    <div style={{ fontSize: 9, color: "#4b5563", marginTop: 2 }}>USDC / day</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8, padding: "10px 0", borderTop: `1px solid ${scoreBdr(sc)}`, borderBottom: `1px solid ${scoreBdr(sc)}`, marginBottom: 10 }}>
                  {[
                    { label: "Spread actual", value: `${m.spread.toFixed(2)}%`, color: canEarn ? "#34d399" : "#f87171", info: "Spread actual vs máximo permitido" },
                    { label: "Max spread", value: `${m.rewardsMaxSpread}%`, color: "#a5b4fc", info: "Spread máximo para ganar rewards" },
                    { label: "Competencia", value: (m.competitive * 100).toFixed(1) + "%", color: cc, info: "% de competencia — más bajo = más fácil" },
                    { label: "Rewards/día", value: `$${m.rewardsDailyRate.toLocaleString()}`, color: "#34d399", info: "USDC pagados por día a LPs" },
                    { label: "Cierre", value: fmtDays(m.daysLeft), color: m.daysLeft >= 30 ? "#34d399" : m.daysLeft >= 7 ? "#fcd34d" : "#f97316", info: "Tiempo hasta resolución" },
                    { label: "Liquidez", value: fmtVol(m.liquidity), color: "#9ca3af", info: "Liquidez total del mercado" },
                    { label: "Min. orden", value: `$${m.rewardsMinSize}`, color: "#9ca3af", info: "Orden mínima para optar a rewards" },
                  ].map(({ label, value, color, info }) => (
                    <div key={label} title={info}>
                      <div style={{ fontSize: 9, color: "#374151", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 11, color: "#374151" }}>
                    Keep orders within <span style={{ color: "#a5b4fc", fontWeight: 600 }}>{m.rewardsMaxSpread}% spread</span> · min <span style={{ color: "#a5b4fc", fontWeight: 600 }}>${m.rewardsMinSize}</span> per side
                    {m.bestBid > 0 && <span style={{ marginLeft: 8, color: "#1f2937" }}>· bid {fmtPct(m.bestBid)} / ask {fmtPct(m.bestAsk)}</span>}
                  </div>
                  <a href={m.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: "#34d399", textDecoration: "none", padding: "6px 16px", background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 8, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>
                    Open in Polymarket →
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

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Page() {
  const [activeTab, setActiveTab] = useState<"polyedge" | "insider" | "rewards">("polyedge");
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
        maxDays: initialOnly ? "7" : String(f.maxDays),
        minVol: initialOnly ? "10000" : String(f.minVol),
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
            new Notification("PolyEdge", { body: `+${detected.size} new market${detected.size > 1 ? "s" : ""}` });
        } else setNewIds(new Set());
      } else setNewIds(new Set());
      prevIdsRef.current = incomingIds;
      setMarkets(incoming);
      setFetchedAt(data.fetchedAt);
      setIsInitialLoad(initialOnly);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
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
    if (sortKey === "days") diff = a.daysLeft - b.daysLeft;
    if (sortKey === "volume") diff = b.volume - a.volume;
    if (sortKey === "gain") diff = 1 / a.bestProb - 1 / b.bestProb;
    return sortDir === "asc" ? -diff : diff;
  });

  const avgProb = markets.length ? markets.reduce((s, m) => s + m.bestProb, 0) / markets.length : 0;
  const totalVol = markets.reduce((s, m) => s + m.volume, 0);
  const sortLabels: Record<SortKey, string> = { prob: "Prob.", days: "Time", volume: "Vol.", gain: "Gain" };
  const sl = (k: SortKey) => sortLabels[k] + (sortKey === k ? (sortDir === "desc" ? "↓" : "↑") : "");
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
        .tabbtn{transition:all 0.15s;cursor:pointer;background:transparent;border:none;}
        .tabbtn:hover{color:#e5e7eb!important;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px;}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
      `}</style>

      {/* HEADER */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", paddingBottom: "1.25rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em", color: "#fff" }}>PolyEdge</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 4, padding: "2px 6px", letterSpacing: "0.08em" }}>BETA</span>
              {alertCount > 0 && (
                <span onClick={() => setAlertCount(0)} style={{ fontSize: 10, background: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 99, padding: "2px 8px", cursor: "pointer", fontWeight: 600 }}>
                  +{alertCount} new market{alertCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#4b5563", marginTop: 1 }}>
              {fetchedAt ? `Updated ${new Date(fetchedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}` : "High-probability prediction markets · Polymarket"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {autoRefresh && <span style={{ fontSize: 11, color: "#4b5563", fontFamily: "'JetBrains Mono',monospace" }}>{fmtCountdown(countdown)}</span>}
          <button onClick={() => { const n = !autoRefresh; setAutoRefresh(n); if (n && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); }}
            style={{ fontSize: 11, padding: "5px 12px", border: `1px solid ${autoRefresh ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, background: autoRefresh ? "rgba(99,102,241,0.15)" : "transparent", color: autoRefresh ? "#a5b4fc" : "#6b7280", cursor: "pointer", fontWeight: 500 }}>
            {autoRefresh ? "● Live ON" : "○ Live"}
          </button>
        </div>
      </header>

      {/* TABS */}
      <nav style={{ display: "flex", gap: 2, marginBottom: "1.5rem", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        {([
          { key: "polyedge" as const, label: "PolyEdge", icon: "◎", badge: null },
          { key: "insider" as const, label: "Insider Activity", icon: "⚡", badge: { text: "LIVE", color: "#f87171", bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.3)" } },
          { key: "rewards" as const, label: "Rewards", icon: "💎", badge: { text: "NEW", color: "#34d399", bg: "rgba(52,211,153,0.15)", border: "rgba(52,211,153,0.3)" } },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className="tabbtn"
            style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, color: activeTab === tab.key ? "#fff" : "#4b5563", borderBottom: `2px solid ${activeTab === tab.key ? "#6366f1" : "transparent"}`, marginBottom: -1, display: "flex", alignItems: "center", gap: 6 }}>
            <span>{tab.icon}</span>
            {tab.label}
            {tab.badge && <span style={{ fontSize: 9, background: tab.badge.bg, color: tab.badge.color, border: `1px solid ${tab.badge.border}`, borderRadius: 99, padding: "1px 6px", fontWeight: 700 }}>{tab.badge.text}</span>}
          </button>
        ))}
      </nav>

      {/* TAB: POLYEDGE */}
      {activeTab === "polyedge" && (
        <>
          <section style={{ marginBottom: "1.25rem" }}>
            <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: sortKey === "prob" ? "#818cf8" : "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{sortKey === "prob" ? "▸ " : ""}Probability</label>
                  <select value={filters.minProb} onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, minProb: v })); setSortKey("prob"); setSortDir("desc"); }} style={selStyle(sortKey === "prob")}>
                    {PROB_OPTS.map(v => <option key={v} value={v} style={{ background: "#111" }}>{v * 100}%+</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: sortKey === "days" ? "#818cf8" : "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{sortKey === "days" ? "▸ " : ""}Closes in</label>
                  <select value={filters.maxDays} onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, maxDays: v })); setSortKey("days"); setSortDir("asc"); }} style={selStyle(sortKey === "days")}>
                    {DAYS_VALS.map((v, i) => <option key={v} value={v} style={{ background: "#111" }}>{DAYS_LABELS[i]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: sortKey === "volume" ? "#818cf8" : "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{sortKey === "volume" ? "▸ " : ""}Min. volume</label>
                  <select value={filters.minVol} onChange={e => { const v = parseFloat(e.target.value); setFilters(f => ({ ...f, minVol: v })); if (v > 0) { setSortKey("volume"); setSortDir("desc"); } }} style={selStyle(sortKey === "volume")}>
                    {VOL_VALS.map((v, i) => <option key={v} value={v} style={{ background: "#111" }}>{VOL_LABELS[i]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 9, color: "#374151", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Category</label>
                  <select value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))} style={selStyle(false)}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value} style={{ background: "#111" }}>{c.label}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  <label style={{ display: "block", fontSize: 9, color: "transparent", marginBottom: 5, fontWeight: 700 }}>·</label>
                  <button onClick={() => doFetch(false, false)} disabled={loading} className="srchbtn"
                    style={{ padding: "7px 12px", background: "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 600, cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1 }}>
                    {loading ? "Searching..." : "Search markets →"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {error && <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#fca5a5", fontSize: 12, marginBottom: "1rem" }}>{error}</div>}

          {markets.length > 0 && (
            <section style={{ marginBottom: "1.25rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
                {[
                  { label: "Markets", value: String(markets.length), color: "#fff" },
                  { label: "Avg. prob.", value: fmtPct(avgProb), color: "#a5b4fc" },
                  { label: "Total volume", value: fmtVol(totalVol), color: "#fff" },
                  { label: "Avg. gain", value: markets.length ? ((1 / avgProb - 1) * 100).toFixed(1) + "%" : "—", color: "#34d399" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace", letterSpacing: "-0.02em" }}>{value}</div>
                    <div style={{ fontSize: 9, color: "#374151", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>{label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {sorted.length > 0 && (
            <section style={{ marginBottom: "0.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Sort:</span>
                {(["prob","days","volume","gain"] as SortKey[]).map(k => (
                  <button key={k} onClick={() => handleSort(k)} className="sbtn"
                    style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${sortKey === k ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: 99, background: sortKey === k ? "rgba(99,102,241,0.18)" : "transparent", color: sortKey === k ? "#a5b4fc" : "#6b7280", fontWeight: sortKey === k ? 600 : 400 }}>
                    {sl(k)}
                  </button>
                ))}
                {newIds.size > 0 && <span style={{ marginLeft: "auto", fontSize: 10, color: "#fca5a5", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 99, padding: "2px 8px" }}>+{newIds.size} new</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 52px 52px 80px 62px 62px 70px 76px", gap: 8, padding: "5px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["MARKET","YES","NO","VOLUME","ORDERS","TRADERS","GAIN",""].map((h, i) => (
                  <div key={i} style={{ fontSize: 9, color: "#374151", fontWeight: 700, letterSpacing: "0.08em" }}>{h}</div>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginBottom: "2rem" }}>
            {loading && <div style={{ textAlign: "center", padding: "2.5rem 0", color: "#374151", fontSize: 13 }}>Loading markets...</div>}
            {!loading && markets.length === 0 && <div style={{ textAlign: "center", padding: "2.5rem 0", color: "#374151", fontSize: 13 }}>No results — try expanding the filters.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {!loading && sorted.map((m, i) => <MarketRow key={m.id} market={m} isNew={newIds.has(m.id)} rank={i + 1} />)}
            </div>
            {!loading && isInitialLoad && markets.length > 0 && (
              <div style={{ textAlign: "center", padding: "12px", background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 10, marginTop: 8 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>Showing <span style={{ color: "#a5b4fc" }}>10 sample markets</span> · Use filters to search more</span>
              </div>
            )}
          </section>

          <section>
            <div style={{ height: 1, background: "linear-gradient(90deg,rgba(99,102,241,0.4),transparent)", marginBottom: "1.25rem" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.875rem", height: 240 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f97316", display: "inline-block", animation: "blink 2s infinite" }} />
                  <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Closing soon</span>
                  <span style={{ fontSize: 9, color: "#374151", marginLeft: "auto" }}>≤ 72h</span>
                </div>
                <div style={{ height: "calc(100% - 30px)" }}><UrgentTerminal markets={markets} /></div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "0.875rem", height: 240 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
                  <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Yahoo Finance</span>
                  <span style={{ fontSize: 9, color: "#374151", marginLeft: "auto" }}>Global markets</span>
                </div>
                <div style={{ height: "calc(100% - 30px)" }}><NewsTerminal /></div>
              </div>
            </div>
          </section>
        </>
      )}

      {activeTab === "insider" && <InsiderTab allMarkets={markets} />}
      {activeTab === "rewards" && <RewardsTab />}

      <footer style={{ marginTop: "1.5rem", paddingTop: "1rem", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#1f2937" }}>PolyEdge · Gamma API · {markets.length} markets</span>
        <span style={{ fontSize: 10, color: "#1f2937" }}>Informational only — not financial advice</span>
      </footer>
    </main>
  );
}

// ── Market Row ────────────────────────────────────────────────────────────────
function MarketRow({ market: m, isNew, rank }: { market: ProcessedMarket; isNew: boolean; rank: number }) {
  const pct = Math.round(m.bestProb * 100);
  const noPct = 100 - pct;
  const gain = ((1 / m.bestProb - 1) * 100).toFixed(1);
  const probColor = pct >= 95 ? "#34d399" : pct >= 90 ? "#6ee7b7" : "#fcd34d";
  const estTraders = Math.max(1, Math.round(m.volume / 200));
  const estOrders = Math.max(0, Math.round(m.volume24hr / 50));

  return (
    <div className="mcard" style={{ display: "grid", gridTemplateColumns: "1fr 52px 52px 80px 62px 62px 70px 76px", gap: 8, alignItems: "center", padding: "9px 12px", background: isNew ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)", border: `1px solid ${isNew ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)"}`, borderRadius: 10, position: "relative" }}>
      {isNew && <span style={{ position: "absolute", top: -8, left: 12, fontSize: 9, fontWeight: 700, background: "#6366f1", color: "#fff", borderRadius: 99, padding: "1px 7px", letterSpacing: "0.08em" }}>NEW</span>}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 9, color: "#374151", fontFamily: "'JetBrains Mono',monospace" }}>#{rank}</span>
          {m.category && <span style={{ fontSize: 9, color: "#4b5563", background: "rgba(255,255,255,0.05)", borderRadius: 3, padding: "1px 5px" }}>{m.category}</span>}
          <Sparkline change={m.oneDayPriceChange} prob={m.bestProb} />
          {m.oneDayPriceChange !== 0 && <span style={{ fontSize: 9, color: m.oneDayPriceChange > 0 ? "#34d399" : "#f87171", fontFamily: "'JetBrains Mono',monospace" }}>{m.oneDayPriceChange > 0 ? "+" : ""}{(m.oneDayPriceChange * 100).toFixed(1)}%</span>}
        </div>
        <div style={{ fontSize: 12.5, color: "#e5e7eb", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</div>
        {m.bestBid > 0 && <div style={{ fontSize: 9, color: "#374151", marginTop: 2, fontFamily: "'JetBrains Mono',monospace" }}>bid {fmtPct(m.bestBid)} · ask {fmtPct(m.bestAsk)} · spr {(m.spread * 100).toFixed(1)}%</div>}
      </div>
      <div style={{ textAlign: "center", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 7, padding: "5px 4px" }}>
        <div style={{ fontSize: 8, color: "#34d399", fontWeight: 700 }}>YES</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>{pct}¢</div>
      </div>
      <div style={{ textAlign: "center", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 7, padding: "5px 4px" }}>
        <div style={{ fontSize: 8, color: "#f87171", fontWeight: 700 }}>NO</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#f87171", fontFamily: "'JetBrains Mono',monospace", lineHeight: 1.2 }}>{noPct}¢</div>
      </div>
      <div><div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{fmtVol(m.volume)}</div><div style={{ fontSize: 9, color: "#4b5563" }}>{fmtVol(m.volume24hr)}/24h</div></div>
      <div><div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{estOrders > 0 ? estOrders : "—"}</div><div style={{ fontSize: 9, color: "#4b5563" }}>24h</div></div>
      <div><div style={{ fontSize: 12, fontWeight: 600, color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>{estTraders > 999 ? fmtVol(estTraders).replace("$","") : estTraders}</div><div style={{ fontSize: 9, color: "#4b5563" }}>approx.</div></div>
      <div><div style={{ fontSize: 13, fontWeight: 700, color: probColor, fontFamily: "'JetBrains Mono',monospace" }}>+{gain}%</div><div style={{ fontSize: 9, color: "#4b5563" }}>{fmtDays(m.daysLeft)}</div></div>
      <a href={m.url} target="_blank" rel="noopener noreferrer" className="pl" style={{ fontSize: 11, color: "#818cf8", textDecoration: "none", padding: "5px 10px", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 7, fontWeight: 500, textAlign: "center", display: "block" }}>View →</a>
    </div>
  );
}
