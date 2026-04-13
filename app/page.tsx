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

interface InsiderSignal {
  market: ProcessedMarket;
  spikeRatio: number;
  hourlyAvg: number;
  lastHourVol: number;
  alertLevel: "MODERATE" | "HIGH" | "EXTREME";
  detectedAt: string;
}

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
function InsiderTab({ allMarkets }: { allMarkets: ProcessedMarket[] }) {
  const [signals, setSignals] = useState<InsiderSignal[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    setScanning(true); setError(null);
    try {
      const qs = new URLSearchParams({ minProb: "0.05", maxDays: "30", minVol: "50000", category: "Politics" });
      const res = await fetch(`/api/markets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "API Error");
      const politicalMarkets: ProcessedMarket[] = (data.markets ?? []).filter((m: ProcessedMarket) => m.volume24hr > 0).slice(0, 40);
      const detected: InsiderSignal[] = [];
      for (const market of politicalMarkets) {
        const daysActive = Math.max(1, 30 - market.daysLeft);
        const estimatedDailyAvg = market.volume / daysActive;
        const estimatedHourlyAvg = estimatedDailyAvg / 24;
        if (estimatedHourlyAvg <= 0) continue;
        const spikeRatio = market.volume24hr / estimatedDailyAvg;
        if (spikeRatio < 2.5) continue;
        let alertLevel: "MODERATE" | "HIGH" | "EXTREME" = "MODERATE";
        if (spikeRatio >= 10) alertLevel = "EXTREME";
        else if (spikeRatio >= 5) alertLevel = "HIGH";
        detected.push({ market, spikeRatio, hourlyAvg: estimatedHourlyAvg, lastHourVol: market.volume24hr / 8, alertLevel, detectedAt: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) });
      }
      detected.sort((a, b) => b.spikeRatio - a.spikeRatio);
      setSignals(detected.slice(0, 15));
      setLastScan(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Scan error"); }
    finally { setScanning(false); }
  }, []);

  useEffect(() => { scan(); const i = setInterval(scan, 5 * 60 * 1000); return () => clearInterval(i); }, [scan]);

  const alertColors: Record<string, { bg: string; border: string; text: string }> = {
    MODERATE: { bg: "rgba(253,224,71,0.06)", border: "rgba(253,224,71,0.2)", text: "#fcd34d" },
    HIGH:     { bg: "rgba(251,146,60,0.07)", border: "rgba(251,146,60,0.22)", text: "#fb923c" },
    EXTREME:  { bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.28)", text: "#f87171" },
  };
  const alertLabels: Record<string, string> = { MODERATE: "MODERATE", HIGH: "HIGH", EXTREME: "EXTREME" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: scanning ? "#f97316" : signals.length > 0 ? "#f87171" : "#34d399", animation: scanning ? "blink 1s infinite" : "none" }} />
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>Insider Activity Detector</h2>
          </div>
          <p style={{ fontSize: 12, color: "#4b5563" }}>Political markets with abnormal hourly volume spikes{lastScan && <span style={{ color: "#374151" }}> · Last scan: {lastScan}</span>}</p>
        </div>
        <button onClick={scan} disabled={scanning} style={{ fontSize: 12, padding: "7px 16px", background: scanning ? "rgba(99,102,241,0.2)" : "linear-gradient(135deg,#4f46e5,#7c3aed)", border: "1px solid rgba(99,102,241,0.4)", borderRadius: 8, color: "#fff", fontWeight: 600, cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}>
          {scanning ? "⟳ Scanning..." : "Scan now"}
        </button>
      </div>
      <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 12, padding: "1rem", marginBottom: "1.5rem" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>How it works</div>
        <p style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>We scan active political markets every 5 minutes. For each market we estimate the daily average volume and compare it against the last 24h volume. A spike of 3x or more — with no apparent news — may indicate insider positioning before a major announcement.</p>
        <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
          {[{ label: "MODERATE", threshold: "2.5x – 5x", color: "#fcd34d" }, { label: "HIGH", threshold: "5x – 10x", color: "#fb923c" }, { label: "EXTREME", threshold: "> 10x", color: "#f87171" }].map(({ label, threshold, color }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 11, color: "#6b7280" }}><span style={{ color, fontWeight: 600 }}>{label}</span> {threshold}</span>
            </div>
          ))}
        </div>
      </div>
      {error && <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, color: "#fca5a5", fontSize: 12, marginBottom: "1rem" }}>{error}</div>}
      {scanning && <div style={{ textAlign: "center", padding: "3rem 0", color: "#4b5563", fontSize: 13 }}>Scanning political markets for anomalies...</div>}
      {!scanning && signals.length === 0 && <div style={{ textAlign: "center", padding: "3rem 0" }}><div style={{ fontSize: 32, marginBottom: 12 }}>🟢</div><div style={{ fontSize: 14, color: "#4b5563" }}>No insider signals detected right now.</div></div>}
      {!scanning && signals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {signals.map((s, i) => {
            const ac = alertColors[s.alertLevel];
            const pct = Math.round(s.market.bestProb * 100);
            const priceColor = s.market.oneDayPriceChange > 0.05 ? "#34d399" : s.market.oneDayPriceChange < -0.05 ? "#f87171" : "#9ca3af";
            return (
              <div key={s.market.id} style={{ background: ac.bg, border: `1px solid ${ac.border}`, borderRadius: 14, padding: "1rem 1.25rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: ac.text, border: `1px solid ${ac.border}`, borderRadius: 4, padding: "2px 8px", letterSpacing: "0.1em" }}>⚡ {alertLabels[s.alertLevel]}</span>
                  <span style={{ fontSize: 11, color: ac.text, fontFamily: "monospace", fontWeight: 700 }}>{s.spikeRatio.toFixed(1)}x spike</span>
                  <span style={{ fontSize: 10, color: "#374151", marginLeft: "auto" }}>#{i + 1} · {s.detectedAt}</span>
                </div>
                <p style={{ fontSize: 13.5, color: "#e5e7eb", lineHeight: 1.5, marginBottom: 12, fontWeight: 500 }}>{s.market.question}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 10, marginBottom: 12 }}>
                  <div><div style={{ fontSize: 9, color: "#374151", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Volume spike</div><SpikeChart spikeRatio={s.spikeRatio} /></div>
                  {[
                    { label: "Hourly avg.", value: fmtVol(s.hourlyAvg), color: "#9ca3af" },
                    { label: "Last 8h est.", value: fmtVol(s.lastHourVol), color: ac.text },
                    { label: "24h volume", value: fmtVol(s.market.volume24hr), color: "#a5b4fc" },
                    { label: "Price move", value: (s.market.oneDayPriceChange * 100 > 0 ? "+" : "") + (s.market.oneDayPriceChange * 100).toFixed(1) + "%", color: priceColor },
                    { label: "Time left", value: fmtDays(s.market.daysLeft), color: "#fb923c" },
                    { label: "Liquidity", value: fmtVol(s.market.volume), color: "#9ca3af" },
                  ].map(({ label, value, color }) => (
                    <div key={label}><div style={{ fontSize: 9, color: "#374151", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div><div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div></div>
                  ))}
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
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: `1px solid ${ac.border}` }}>
                  <div style={{ fontSize: 10, color: "#374151", fontFamily: "monospace" }}>{s.market.bestBid > 0 && `bid ${fmtPct(s.market.bestBid)} · ask ${fmtPct(s.market.bestAsk)} · spr ${(s.market.spread * 100).toFixed(1)}%`}</div>
                  <a href={s.market.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: ac.text, textDecoration: "none", padding: "5px 14px", border: `1px solid ${ac.border}`, borderRadius: 8, fontWeight: 600 }}>View →</a>
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
  const [sortBy, setSortBy] = useState<"score" | "reward" | "competition" | "days">("score");
  const [minReward, setMinReward] = useState(50);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const tagIds = [6, 99, 400, 718, 10, 100265, 12, 21, 279];
      const [recentPages, tagPages] = await Promise.all([
        Promise.all(Array.from({ length: 12 }, (_, i) =>
          fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=100&offset=${i * 100}&order=id&ascending=false`, { headers: { Accept: "application/json" }, cache: "no-store" })
            .then(r => r.ok ? r.json() : []).catch(() => [])
        )),
        Promise.all(tagIds.map(id =>
          fetch(`https://gamma-api.polymarket.com/events?tag_id=${id}&active=true&closed=false&limit=100`, { headers: { Accept: "application/json" }, cache: "no-store" })
            .then(r => r.ok ? r.json() : []).catch(() => [])
        )),
      ]);

      const allEvents: any[] = [...recentPages.flat(), ...tagPages.flat()];
      const seenEvt = new Set<string>();
      const uniqueEvents = allEvents.filter(e => { const id = String(e.id); if (seenEvt.has(id)) return false; seenEvt.add(id); return true; });

      const mapped: RewardMarket[] = [];
      for (const event of uniqueEvents) {
        for (const m of (event.markets ?? [])) {
          if (!m.acceptingOrders) continue;
          const clob = m.clobRewards ?? [];
          if (!clob.length) continue;
          const dailyRate = parseFloat(clob[0]?.rewardsDailyRate ?? "0");
          if (dailyRate <= 0) continue;
          const now = Date.now();
          const endTime = m.endDate ? new Date(m.endDate).getTime() : now + 999 * 86400000;
          const daysLeft = (endTime - now) / 86400000;
          if (daysLeft <= 0) continue;
          const competitive = parseFloat(m.competitive ?? "0");
          const spread = parseFloat(m.spread ?? "1") * 100;
          const maxSpr = parseFloat(m.rewardsMaxSpread ?? "4.5");
          const minSize = parseFloat(m.rewardsMinSize ?? "50");
          const liq = parseFloat(m.liquidityClob ?? m.liquidity ?? "0");
          const vol24 = parseFloat(m.volume24hr ?? "0");
          const rewardScore = Math.min(40, (dailyRate / 2000) * 40);
          const compScore   = Math.min(35, (1 - competitive) * 105);
          const spreadScore = spread < maxSpr ? Math.min(15, ((maxSpr - spread) / maxSpr) * 15) : 0;
          const timeScore   = daysLeft > 1 && daysLeft <= 30 ? 10 : daysLeft > 30 ? 5 : 2;
          const opportunityScore = Math.round(rewardScore + compScore + spreadScore + timeScore);
          const eventSlug = event.slug ?? m.slug ?? "";
          const url = eventSlug ? `https://polymarket.com/event/${eventSlug}` : "https://polymarket.com";
          mapped.push({ id: String(m.id), question: m.question ?? "", url, category: event.category ?? event.tags?.[0]?.label ?? "", rewardsDailyRate: dailyRate, rewardsMinSize: minSize, rewardsMaxSpread: maxSpr, competitive, spread, liquidity: liq, volume24hr: vol24, daysLeft, bestBid: parseFloat(m.bestBid ?? "0"), bestAsk: parseFloat(m.bestAsk ?? "0"), opportunityScore });
        }
      }
      const seenMkt = new Set<string>();
      const unique = mapped.filter(m => { if (seenMkt.has(m.id)) return false; seenMkt.add(m.id); return true; });
      setRewards(unique.sort((a, b) => b.opportunityScore - a.opportunityScore));
      setFetchedAt(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error loading rewards"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = rewards.filter(m => m.rewardsDailyRate >= minReward);
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "reward")      return b.rewardsDailyRate - a.rewardsDailyRate;
    if (sortBy === "competition") return a.competitive - b.competitive;
    if (sortBy === "days")        return a.daysLeft - b.daysLeft;
    return b.opportunityScore - a.opportunityScore;
  });

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
          Polymarket pays market makers who keep resting orders within the allowed spread. The <strong style={{ color: "#d1d5db" }}>Daily Rate</strong> is real USDC paid per day — split among all qualifying LPs. Lower competition = larger share. Use <strong style={{ color: "#d1d5db" }}>Opportunity Score</strong> to find the best risk/reward.
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

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Min reward/day:</span>
        {[50, 100, 300, 500, 1000].map(v => (
          <button key={v} onClick={() => setMinReward(v)} className="sbtn"
            style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${minReward === v ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: 99, background: minReward === v ? "rgba(52,211,153,0.12)" : "transparent", color: minReward === v ? "#34d399" : "#6b7280", fontWeight: minReward === v ? 600 : 400 }}>
            ${v}+
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, color: "#374151", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Sort:</span>
          {([{ k: "score" as const, l: "Opportunity" }, { k: "reward" as const, l: "Reward ↓" }, { k: "competition" as const, l: "Less competed" }, { k: "days" as const, l: "Closes soon" }]).map(({ k, l }) => (
            <button key={k} onClick={() => setSortBy(k)} className="sbtn"
              style={{ fontSize: 11, padding: "3px 10px", border: `1px solid ${sortBy === k ? "rgba(52,211,153,0.5)" : "rgba(255,255,255,0.07)"}`, borderRadius: 99, background: sortBy === k ? "rgba(52,211,153,0.12)" : "transparent", color: sortBy === k ? "#34d399" : "#6b7280", fontWeight: sortBy === k ? 600 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {!loading && sorted.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: "1.25rem" }}>
          {[
            { label: "Markets found", value: String(sorted.length), color: "#fff" },
            { label: "Total pool/day", value: "$" + sorted.reduce((s, m) => s + m.rewardsDailyRate, 0).toLocaleString(undefined, { maximumFractionDigits: 0 }), color: "#34d399" },
            { label: "Top reward/day", value: "$" + Math.max(...sorted.map(m => m.rewardsDailyRate)).toLocaleString(), color: "#fcd34d" },
            { label: "Avg. competition", value: (sorted.reduce((s, m) => s + m.competitive, 0) / sorted.length * 100).toFixed(1) + "%", color: "#fb923c" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color, fontFamily: "'JetBrains Mono',monospace" }}>{value}</div>
              <div style={{ fontSize: 9, color: "#374151", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ textAlign: "center", padding: "3rem 0", color: "#374151", fontSize: 13 }}>Scanning markets for active rewards...</div>}
      {!loading && sorted.length === 0 && <div style={{ textAlign: "center", padding: "3rem 0", color: "#374151", fontSize: 13 }}>No markets found with rewards ≥ ${minReward}/day.</div>}

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
                    { label: "Min. order", value: `$${m.rewardsMinSize}`, color: "#a5b4fc" },
                    { label: "Max spread", value: `${m.rewardsMaxSpread}%`, color: "#a5b4fc" },
                    { label: "Current spread", value: `${m.spread.toFixed(3)}%`, color: canEarn ? "#34d399" : "#f87171" },
                    { label: "Spread room", value: `${spreadRoom.toFixed(3)}%`, color: spreadRoom > 0.5 ? "#34d399" : "#fcd34d" },
                    { label: "Competition", value: (m.competitive * 100).toFixed(1) + "%", color: cc },
                    { label: "Liquidity", value: fmtVol(m.liquidity), color: "#9ca3af" },
                    { label: "Vol. 24h", value: fmtVol(m.volume24hr), color: "#9ca3af" },
                    { label: "Time left", value: fmtDays(m.daysLeft), color: m.daysLeft < 3 ? "#f97316" : "#9ca3af" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
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
