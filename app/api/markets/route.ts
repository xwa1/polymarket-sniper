import { NextRequest, NextResponse } from "next/server";
const GAMMA_BASE = "https://gamma-api.polymarket.com";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minProb = parseFloat(searchParams.get("minProb") ?? "0.90");
  const maxDays = parseFloat(searchParams.get("maxDays") ?? "2");
  const minVol  = parseFloat(searchParams.get("minVol")  ?? "1000");
  const now = new Date();
  const maxClose = new Date(now.getTime() + maxDays * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    active: "true", closed: "false",
    end_date_min: now.toISOString(),
    end_date_max: maxClose.toISOString(),
    limit: "100", order: "end_date_asc",
  });
  try {
    const res = await fetch(`${GAMMA_BASE}/markets?${params}`,
      { headers: { Accept: "application/json" }, next: { revalidate: 300 } });
    if (!res.ok) return NextResponse.json(
      { error: `Gamma API error: ${res.status}` }, { status: 502 });
    const raw = await res.json();
    const markets = raw.map((m: any) => {
      let prices: number[] = [];
      try { prices = JSON.parse(m.outcomePrices ?? "[]").map((p: any) => parseFloat(p)); }
      catch { if (m.lastTradePrice) prices = [m.lastTradePrice]; }
      const bestProb = prices.length ? Math.max(...prices) : 0;
      let outcomes: string[] = [];
      try { outcomes = JSON.parse(m.outcomes ?? '["Yes","No"]'); }
      catch { outcomes = ["Yes", "No"]; }
      const bestOutcomeName = outcomes[prices.indexOf(bestProb)] ?? "Yes";
      const volumeNum = typeof m.volume === "string" ? parseFloat(m.volume) : (m.volume ?? 0);
      const endDate = m.endDateIso ?? m.endDate ?? "";
      const daysLeft = endDate
        ? (new Date(endDate).getTime() - now.getTime()) / (1000*60*60*24) : 999;
      return { id: m.id, question: m.question, slug: m.slug,
        category: m.category ?? "", endDate, daysLeft, bestProb, bestOutcomeName,
        volume: volumeNum, volume24hr: m.volume24hr ?? 0,
        bestBid: m.bestBid ?? 0, bestAsk: m.bestAsk ?? 0,
        spread: m.spread ?? 0, lastTradePrice: m.lastTradePrice ?? 0,
        oneDayPriceChange: m.oneDayPriceChange ?? 0 };
    }).filter((m: any) =>
      m.bestProb >= minProb && m.volume >= minVol &&
      m.daysLeft > 0 && m.daysLeft <= maxDays + 0.042
    ).sort((a: any, b: any) => b.bestProb - a.bestProb);
    const categories = Array.from(
      new Set(raw.map((m: any) => m.category ?? "").filter(Boolean))).sort();
    return NextResponse.json({ markets, categories, fetchedAt: now.toISOString() });
  } catch (err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
