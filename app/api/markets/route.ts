import { NextRequest, NextResponse } from "next/server";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

// Tag IDs → categoría normalizada
const TAG_CATEGORY_MAP: Record<number, string> = {
  21: "Crypto", 235: "Crypto", 1312: "Crypto", 102134: "Crypto",
  102328: "Crypto", 101757: "Crypto",
  12: "Sports", 279: "Sports", 100639: "Sports",
  6: "Politics", 99: "Politics", 400: "Politics", 718: "Politics",
  1503: "Weather", 92: "Weather",
  159: "Finance", 1314: "Finance", 102000: "Finance", 102965: "Finance",
  103678: "Finance", 102175: "Finance", 102188: "Finance",
  7: "Entertainment", 128: "Entertainment",
  9: "Technology",
  10: "World",
  11: "Business",
};

const ALL_TAGS = Object.keys(TAG_CATEGORY_MAP).map(Number);

async function fetchEventsByTag(tagId: number): Promise<any[]> {
  try {
    const r = await fetch(
      `${GAMMA_BASE}/events?tag_id=${tagId}&active=true&closed=false&limit=100`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!r.ok) return [];
    const data = await r.json();
    const events = Array.isArray(data) ? data : [];
    // Inyectar categoría garantizada desde el tag
    return events.map((e: any) => ({
      ...e,
      _forcedCategory: TAG_CATEGORY_MAP[tagId],
    }));
  } catch { return []; }
}

async function fetchEventPage(offset: number): Promise<any[]> {
  try {
    const r = await fetch(
      `${GAMMA_BASE}/events?active=true&closed=false&limit=100&offset=${offset}&order=id&ascending=false`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

// Inferir categoría cuando no viene de un tag conocido
function inferCategory(e: any): string {
  // 1. Tags del evento → buscar en mapa
  if (e.tags?.length) {
    for (const t of e.tags) {
      const mapped = TAG_CATEGORY_MAP[parseInt(t.id)];
      if (mapped) return mapped;
    }
    // Fallback por label
    for (const t of e.tags) {
      const label = (t.label ?? "").toLowerCase();
      if (label.includes("crypto") || label.includes("bitcoin") || label.includes("eth")) return "Crypto";
      if (label.includes("sport") || label.includes("nba") || label.includes("nfl") || label.includes("ufc") || label.includes("golf") || label.includes("tennis") || label.includes("soccer") || label.includes("football") || label.includes("baseball") || label.includes("hockey")) return "Sports";
      if (label.includes("politic") || label.includes("election") || label.includes("trump") || label.includes("congress") || label.includes("senate") || label.includes("president") || label.includes("democrat") || label.includes("republican")) return "Politics";
      if (label.includes("weather") || label.includes("climate") || label.includes("temperature") || label.includes("rain") || label.includes("snow")) return "Weather";
      if (label.includes("finance") || label.includes("fed") || label.includes("economy") || label.includes("stock") || label.includes("market")) return "Finance";
      if (label.includes("entertain") || label.includes("twitter") || label.includes("youtube") || label.includes("social") || label.includes("music") || label.includes("film") || label.includes("movie")) return "Entertainment";
      if (label.includes("tech") || label.includes("ai") || label.includes("software") || label.includes("apple") || label.includes("google")) return "Technology";
      if (label.includes("world") || label.includes("international") || label.includes("global") || label.includes("war") || label.includes("conflict")) return "World";
    }
  }

  // 2. Campo category de la API
  const cat = (e.category ?? "").toLowerCase();
  if (cat.includes("crypto") || cat.includes("bitcoin")) return "Crypto";
  if (cat.includes("sport")) return "Sports";
  if (cat.includes("politic") || cat.includes("election")) return "Politics";
  if (cat.includes("weather") || cat.includes("climate")) return "Weather";
  if (cat.includes("finance") || cat.includes("economy")) return "Finance";
  if (cat.includes("entertain") || cat.includes("pop")) return "Entertainment";
  if (cat.includes("tech")) return "Technology";
  if (cat.includes("world") || cat.includes("international")) return "World";
  if (cat.includes("business")) return "Business";

  // 3. Inferir del título/slug
  const title = (e.title ?? e.slug ?? "").toLowerCase();
  if (title.includes("bitcoin") || title.includes("btc") || title.includes("eth") || title.includes("crypto") || title.includes("solana") || title.includes("xrp")) return "Crypto";
  if (title.includes("nba") || title.includes("nfl") || title.includes("nhl") || title.includes("mlb") || title.includes("ufc") || title.includes("masters") || title.includes("golf") || title.includes("tennis") || title.includes("soccer") || title.includes("premier") || title.includes("champions") || title.includes("world cup") || title.includes("playoff")) return "Sports";
  if (title.includes("trump") || title.includes("biden") || title.includes("election") || title.includes("congress") || title.includes("senate") || title.includes("president") || title.includes("democrat") || title.includes("republican") || title.includes("minister") || title.includes("vote")) return "Politics";
  if (title.includes("temperature") || title.includes("weather") || title.includes("rain") || title.includes("snow") || title.includes("celsius") || title.includes("fahrenheit")) return "Weather";
  if (title.includes("fed") || title.includes("rate") || title.includes("inflation") || title.includes("gdp") || title.includes("cpi") || title.includes("payroll") || title.includes("recession")) return "Finance";
  if (title.includes("youtube") || title.includes("twitter") || title.includes("instagram") || title.includes("tiktok") || title.includes("spotify") || title.includes("grammy") || title.includes("oscar")) return "Entertainment";

  return "";
}

function processMarket(m: any, eventSlug: string, category: string, now: Date) {
  let prices: number[] = [];
  try {
    prices = JSON.parse(m.outcomePrices ?? "[]").map((p: any) => parseFloat(p));
  } catch { if (m.lastTradePrice) prices = [m.lastTradePrice]; }
  const bestProb = prices.length ? Math.max(...prices) : 0;

  let outcomes: string[] = [];
  try { outcomes = JSON.parse(m.outcomes ?? '["Yes","No"]'); } catch { outcomes = ["Yes", "No"]; }
  const bestOutcomeName = outcomes[prices.indexOf(bestProb)] ?? "Yes";

  const vol = typeof m.volume === "string" ? parseFloat(m.volume) : (m.volume ?? 0);

  let endDate = m.endDate ?? m.endDateIso ?? "";
  let endTime: number;
  if (endDate) {
    endTime = /^\d{4}-\d{2}-\d{2}$/.test(endDate)
      ? new Date(endDate + "T23:59:59Z").getTime()
      : new Date(endDate).getTime();
  } else {
    endTime = now.getTime() + 999 * 24 * 60 * 60 * 1000;
  }
  const daysLeft = (endTime - now.getTime()) / (1000 * 60 * 60 * 24);

  const slug = m.slug ?? "";
  const url = eventSlug
    ? `https://polymarket.com/event/${eventSlug}`
    : slug ? `https://polymarket.com/event/${slug}` : `https://polymarket.com`;

  return {
    id: String(m.id),
    question: m.question ?? m.groupItemTitle ?? "",
    slug, url, category, endDate, daysLeft, bestProb, bestOutcomeName,
    volume: vol, volume24hr: m.volume24hr ?? 0,
    bestBid: m.bestBid ?? 0, bestAsk: m.bestAsk ?? 0,
    spread: m.spread ?? 0, lastTradePrice: m.lastTradePrice ?? 0,
    oneDayPriceChange: m.oneDayPriceChange ?? 0,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minProb = parseFloat(searchParams.get("minProb") ?? "0.90");
  const maxDays = parseFloat(searchParams.get("maxDays") ?? "7");
  const minVol = parseFloat(searchParams.get("minVol") ?? "1000");
  const categoryFilter = searchParams.get("category") ?? "";
  const now = new Date();

  try {
    // Fetch en paralelo
    const recentOffsets = Array.from({ length: 10 }, (_, i) => i * 100);
    const [tagPages, recentPages] = await Promise.all([
      Promise.all(ALL_TAGS.map(fetchEventsByTag)),
      Promise.all(recentOffsets.map(fetchEventPage)),
    ]);

    // CRÍTICO: primero los eventos por tag (tienen categoría garantizada)
    // luego los recientes. La deduplicación respeta el PRIMERO encontrado.
    const tagEvents = tagPages.flat();
    const recentEvents = recentPages.flat();

    // Mapa de eventos: ID → evento con mejor categoría
    const eventMap = new Map<string, any>();

    // 1. Insertar eventos por tag primero (categoría garantizada)
    for (const e of tagEvents) {
      const id = String(e.id);
      const existing = eventMap.get(id);
      // Si ya existe pero sin categoría forzada, sustituir
      if (!existing || !existing._forcedCategory) {
        eventMap.set(id, e);
      }
    }

    // 2. Añadir eventos recientes que no existan aún
    for (const e of recentEvents) {
      const id = String(e.id);
      if (!eventMap.has(id)) {
        eventMap.set(id, e);
      }
    }

    const uniqueEvents = Array.from(eventMap.values());

    // Aplanar a mercados con categoría correcta
    const allMarkets = uniqueEvents.flatMap(e => {
      // La categoría forzada por tag tiene prioridad absoluta
      const category = e._forcedCategory || inferCategory(e);
      return (e.markets ?? []).map((m: any) => ({
        ...m,
        _eventSlug: e.slug ?? "",
        _category: category,
      }));
    });

    // Deduplicar mercados por ID (misma lógica: primero gana)
    const seenMarkets = new Set<string>();
    const uniqueMarkets = allMarkets.filter(m => {
      const id = String(m.id);
      if (seenMarkets.has(id)) return false;
      seenMarkets.add(id);
      return true;
    });

    const processed = uniqueMarkets
      .map(m => processMarket(m, m._eventSlug, m._category, now))
      .filter(m => {
        if (m.bestProb < minProb) return false;
        if (m.volume < minVol) return false;
        if (m.daysLeft < -0.1) return false;
        if (m.daysLeft > maxDays) return false;
        if (categoryFilter !== "" && m.category !== categoryFilter) return false;
        return true;
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);

    return NextResponse.json({ markets: processed, fetchedAt: now.toISOString() });
  } catch (err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export interface ProcessedMarket {
  id: string; question: string; slug: string; url: string; category: string;
  endDate: string; daysLeft: number; bestProb: number; bestOutcomeName: string;
  volume: number; volume24hr: number; bestBid: number; bestAsk: number;
  spread: number; lastTradePrice: number; oneDayPriceChange: number;
}
