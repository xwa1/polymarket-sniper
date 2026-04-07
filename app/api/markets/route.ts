import { NextRequest, NextResponse } from "next/server";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

// Tag IDs reales de Polymarket
const TAGS = [
  { id: 21,   name: "Crypto" },
  { id: 235,  name: "Crypto" },
  { id: 1312, name: "Crypto" },
  { id: 12,   name: "Sports" },
  { id: 6,    name: "Politics" },
  { id: 1503, name: "Weather" },
  { id: 1314, name: "Finance" },
  { id: 7,    name: "Entertainment" },
  { id: 8,    name: "Science" },
  { id: 9,    name: "Technology" },
  { id: 10,   name: "World" },
  { id: 11,   name: "Business" },
];

async function fetchEventsByTag(tagId: number): Promise<any[]> {
  try {
    const r = await fetch(
      `${GAMMA_BASE}/events?tag_id=${tagId}&active=true&closed=false&limit=100`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!r.ok) return [];
    const data = await r.json();
    const events = Array.isArray(data) ? data : [];
    return events.flatMap((e: any) =>
      (e.markets ?? []).map((m: any) => ({
        ...m,
        category: m.category || TAGS.find(t => t.id === tagId)?.name || "",
        eventSlug: e.slug ?? "",
      }))
    );
  } catch {
    return [];
  }
}

async function fetchByOffset(offset: number): Promise<any[]> {
  try {
    const r = await fetch(
      `${GAMMA_BASE}/markets?active=true&closed=false&limit=100&offset=${offset}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function processMarket(m: any, now: Date): any {
  let prices: number[] = [];
  try {
    prices = JSON.parse(m.outcomePrices ?? "[]").map((p: any) => parseFloat(p));
  } catch {
    if (m.lastTradePrice) prices = [m.lastTradePrice];
  }
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
  const eventSlug = m.eventSlug ?? m.events?.[0]?.slug ?? "";
  const url = eventSlug
    ? `https://polymarket.com/event/${eventSlug}`
    : slug ? `https://polymarket.com/event/${slug}` : `https://polymarket.com`;

  return {
    id: m.id,
    question: m.question ?? m.groupItemTitle ?? "",
    slug,
    url,
    category: m.category ?? "",
    endDate,
    daysLeft,
    bestProb,
    bestOutcomeName,
    volume: vol,
    volume24hr: m.volume24hr ?? 0,
    bestBid: m.bestBid ?? 0,
    bestAsk: m.bestAsk ?? 0,
    spread: m.spread ?? 0,
    lastTradePrice: m.lastTradePrice ?? 0,
    oneDayPriceChange: m.oneDayPriceChange ?? 0,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minProb = parseFloat(searchParams.get("minProb") ?? "0.90");
  const maxDays = parseFloat(searchParams.get("maxDays") ?? "2");
  const minVol = parseFloat(searchParams.get("minVol") ?? "1000");
  const categoryFilter = searchParams.get("category") ?? "";
  const now = new Date();

  try {
    // 1. Fetch por tag IDs (captura mercados diarios recientes como Bitcoin)
    const tagResults = await Promise.all(TAGS.map(t => fetchEventsByTag(t.id)));

    // 2. Fetch por offset para mercados sin tag (los primeros 500)
    const offsetResults = await Promise.all(
      [0, 100, 200, 300, 400].map(fetchByOffset)
    );

    const allRaw = [...tagResults.flat(), ...offsetResults.flat()];

    // Deduplicar por ID
    const seen = new Set<string>();
    const unique = allRaw.filter(m => {
      const id = String(m.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const markets = unique
      .map(m => processMarket(m, now))
      .filter(m =>
        m.bestProb >= minProb &&
        m.volume >= minVol &&
        m.daysLeft > -0.1 &&
        m.daysLeft <= maxDays &&
        (categoryFilter === "" || m.category === categoryFilter)
      )
      .sort((a, b) => a.daysLeft - b.daysLeft);

    // Categorías disponibles basadas en lo que realmente hay
    const categories = Array.from(
      new Set(unique.map((m: any) => m.category ?? "").filter(Boolean))
    ).sort();

    return NextResponse.json({ markets, categories, fetchedAt: now.toISOString() });
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
