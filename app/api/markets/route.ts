import { NextRequest, NextResponse } from "next/server";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

// Fetch de eventos paginados por ID descendente (los más nuevos primero)
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

// Fetch por tag para categorías específicas (captura mercados diarios crypto, política, etc.)
async function fetchEventsByTag(tagId: number): Promise<any[]> {
  try {
    const r = await fetch(
      `${GAMMA_BASE}/events?tag_id=${tagId}&active=true&closed=false&limit=100`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function processMarket(m: any, eventSlug: string, eventCategory: string, now: Date) {
  let prices: number[] = [];
  try {
    prices = JSON.parse(m.outcomePrices ?? "[]").map((p: any) => parseFloat(p));
  } catch { if (m.lastTradePrice) prices = [m.lastTradePrice]; }
  const bestProb = prices.length ? Math.max(...prices) : 0;

  let outcomes: string[] = [];
  try { outcomes = JSON.parse(m.outcomes ?? '["Yes","No"]'); } catch { outcomes = ["Yes","No"]; }
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

  const category = m.category || eventCategory || "";

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
  const maxDays = parseFloat(searchParams.get("maxDays") ?? "2");
  const minVol = parseFloat(searchParams.get("minVol") ?? "1000");
  const categoryFilter = searchParams.get("category") ?? "";
  const now = new Date();

  // Tags clave: Crypto(21), Bitcoin(235), CryptoPrices(1312), Politics(6?),
  // Sports(12), Weather/Climate tags, PopCulture, Twitter(128), RecurringMarkets(101757)
  const KEY_TAGS = [21, 235, 1312, 12, 279, 128, 101757, 102134, 102175, 102188];

  try {
    // 1. Eventos más recientes (offsets 0-900, ordenados por ID desc)
    const recentOffsets = Array.from({ length: 10 }, (_, i) => i * 100);
    // 2. Tags específicos para mercados diarios
    const [recentPages, tagPages] = await Promise.all([
      Promise.all(recentOffsets.map(fetchEventPage)),
      Promise.all(KEY_TAGS.map(fetchEventsByTag)),
    ]);

    const allEvents = [...recentPages.flat(), ...tagPages.flat()];

    // Deduplicar eventos por ID
    const seenEvents = new Set<string>();
    const uniqueEvents = allEvents.filter(e => {
      const id = String(e.id);
      if (seenEvents.has(id)) return false;
      seenEvents.add(id);
      return true;
    });

    // Extraer categoría del evento
    const getEventCategory = (e: any): string => {
      if (e.category) return e.category;
      if (e.tags?.length) return e.tags[0].label ?? "";
      return "";
    };

    // Aplanar a mercados individuales
    const allMarkets = uniqueEvents.flatMap(e =>
      (e.markets ?? []).map((m: any) => ({
        ...m,
        _eventSlug: e.slug ?? "",
        _eventCategory: getEventCategory(e),
      }))
    );

    // Deduplicar mercados por ID
    const seenMarkets = new Set<string>();
    const uniqueMarkets = allMarkets.filter(m => {
      const id = String(m.id);
      if (seenMarkets.has(id)) return false;
      seenMarkets.add(id);
      return true;
    });

    const processed = uniqueMarkets
      .map(m => processMarket(m, m._eventSlug, m._eventCategory, now))
      .filter(m =>
        m.bestProb >= minProb &&
        m.volume >= minVol &&
        m.daysLeft > -0.1 &&
        m.daysLeft <= maxDays &&
        (categoryFilter === "" || m.category === categoryFilter)
      )
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const categories = Array.from(
      new Set(uniqueMarkets.map((m: any) => m.category || m._eventCategory || "").filter(Boolean))
    ).sort();

    return NextResponse.json({ markets: processed, categories, fetchedAt: now.toISOString() });
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
