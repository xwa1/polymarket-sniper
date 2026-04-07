import { NextRequest, NextResponse } from "next/server";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minProb = parseFloat(searchParams.get("minProb") ?? "0.90");
  const maxDays = parseFloat(searchParams.get("maxDays") ?? "2");
  const minVol = parseFloat(searchParams.get("minVol") ?? "1000");
  const now = new Date();

  try {
    const res = await fetch(
      `${GAMMA_BASE}/markets?active=true&closed=false&limit=500&order=end_date&ascending=true`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `Gamma API error: ${res.status}` },
        { status: 502 }
      );
    }

    const raw = await res.json();

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
        try {
          outcomes = JSON.parse(m.outcomes ?? '["Yes","No"]');
        } catch {
          outcomes = ["Yes", "No"];
        }

        const bestOutcomeName = outcomes[prices.indexOf(bestProb)] ?? "Yes";
        const vol = typeof m.volume === "string" ? parseFloat(m.volume) : (m.volume ?? 0);
        const endDate = m.endDate ?? m.endDateIso ?? "";
        const daysLeft = endDate
          ? (new Date(endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          : 999;

        return {
          id: m.id,
          question: m.question,
          slug: m.slug,
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
          m.daysLeft > 0 &&
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
