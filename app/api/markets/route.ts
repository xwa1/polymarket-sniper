import { NextRequest, NextResponse } from "next/server";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

async function fetchPage(offset: number): Promise<any[]> {
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minProb = parseFloat(searchParams.get("minProb") ?? "0.90");
  const maxDays = parseFloat(searchParams.get("maxDays") ?? "2");
  const minVol = parseFloat(searchParams.get("minVol") ?? "1000");
  const now = new Date();

  try {
    // Cubrir 5000 mercados en paralelo: offsets 0-4900
    const offsets = Array.from({ length: 50 }, (_, i) => i * 100);
    const pages = await Promise.all(offsets.map(fetchPage));
    const raw = pages.flat();

    if (raw.length === 0) {
      return NextResponse.json({ error: "Gamma API error: no data" }, { status: 502 });
    }

    const markets = raw
      .map((m: any) => {
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

        // Parsear fecha — si viene solo YYYY-MM-DD tratar como fin del día UTC
        let endDate = m.endDate ?? m.endDateIso ?? "";
        let endTime: number;
        if (endDate) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
            endTime = new Date(endDate + "T23:59:59Z").getTime();
          } else {
            endTime = new Date(endDate).getTime();
          }
        } else {
          endTime = now.getTime() + 999 * 24 * 60 * 60 * 1000;
        }
        const daysLeft = (endTime - now.getTime()) / (1000 * 60 * 60 * 24);

        // URL correcta
        const slug = m.slug ?? "";
        const eventSlug = m.events?.[0]?.slug ?? "";
        const url = eventSlug
          ? `https://polymarket.com/event/${eventSlug}`
          : slug
          ? `https://polymarket.com/event/${slug}`
          : `https://polymarket.com`;

        return {
          id: m.id,
          question: m.question,
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
      })
      .filter(
        (m: any) =>
          m.bestProb >= minProb &&
          m.volume >= minVol &&
          m.daysLeft > -0.1 &&
          m.daysLeft <= maxDays
      )
      .sort((a: any, b: any) => a.daysLeft - b.daysLeft);

    const categories = Array.from(
      new Set(raw.map((m: any) => m.category ?? "").filter(Boolean))
    ).sort();

    return NextResponse.json({ markets, categories, fetchedAt: now.toISOString() });
  } catch (err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export interface ProcessedMarket {
  id: string;
  question: string;
  slug: string;
  url: string;
  category: string;
  endDate: string;
  daysLeft: number;
  bestProb: number;
  bestOutcomeName: string;
  volume: number;
  volume24hr: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
  lastTradePrice: number;
  oneDayPriceChange: number;
}
