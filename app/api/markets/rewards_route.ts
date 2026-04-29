import { NextRequest, NextResponse } from "next/server";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

export async function GET(req: NextRequest) {
  try {
    // Fetch desde el servidor (sin CORS) con rewardsMinSize=50
    const pages = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fetch(
          `${GAMMA_BASE}/markets?active=true&closed=false&limit=100&offset=${i * 100}&rewardsMinSize=50`,
          { headers: { Accept: "application/json" }, cache: "no-store" }
        ).then(r => r.ok ? r.json() : []).catch(() => [])
      )
    );

    const allMarkets: any[] = pages.flat();
    const now = Date.now();
    const mapped: any[] = [];

    for (const m of allMarkets) {
      if (!m.acceptingOrders) continue;

      // rewardsDailyRate real de clobRewards
      const clob = m.clobRewards ?? [];
      const dailyRate = clob.length > 0 ? Number(clob[0]?.rewardsDailyRate ?? 0) : 0;
      if (dailyRate <= 0) continue;

      const minSize = Number(m.rewardsMinSize ?? 0);
      const maxSpr  = Number(m.rewardsMaxSpread ?? 0);
      if (minSize <= 0 || maxSpr <= 0) continue;

      const endTime  = m.endDate ? new Date(m.endDate).getTime() : now + 999 * 86400000;
      const daysLeft = (endTime - now) / 86400000;
      if (daysLeft <= 0) continue;

      const competitive = Number(m.competitive ?? 0);
      const spread      = Number(m.spread ?? 1) * 100;
      const liq         = Number(m.liquidityClob ?? m.liquidity ?? 0);
      const vol24       = Number(m.volume24hr ?? 0);
      const priceChange = Math.abs(Number(m.oneDayPriceChange ?? 0));

      // FARMING SCORE (0-100)
      // 1. Spread bajo (25pts) — más bajo = más fácil entrar/salir
      const spreadScore = Math.round((1 - Math.min(1, spread / maxSpr)) * 25);
      // 2. Baja competencia (25pts) — más share de la pool
      const compScore   = Math.round((1 - competitive) * 25);
      // 3. Rewards altas (20pts) — rewardsDailyRate real
      const rewardScore = Math.min(20, Math.round((dailyRate / 1000) * 20));
      // 4. Cierre lejano (20pts) — farmear tranquilo sin prisas
      const timeScore   = daysLeft >= 30 ? 20 : daysLeft >= 7 ? 12 : daysLeft >= 1 ? 5 : 0;
      // 5. Baja volatilidad (10pts) — precio estable
      const volScore    = Math.round((1 - Math.min(1, priceChange / 0.2)) * 10);
      const farmingScore = Math.round(spreadScore + compScore + rewardScore + timeScore + volScore);

      const eventSlug = m.events?.[0]?.slug ?? m.slug ?? "";
      const url = eventSlug
        ? `https://polymarket.com/event/${eventSlug}`
        : "https://polymarket.com";

      mapped.push({
        id: String(m.id),
        question: m.question ?? "",
        url,
        category: m.category ?? m.events?.[0]?.category ?? "",
        rewardsDailyRate: dailyRate,
        rewardsMinSize: minSize,
        rewardsMaxSpread: maxSpr,
        competitive,
        spread,
        liquidity: liq,
        volume24hr: vol24,
        daysLeft,
        bestBid: Number(m.bestBid ?? 0),
        bestAsk: Number(m.bestAsk ?? 0),
        oneDayPriceChange: priceChange,
        farmingScore,
      });
    }

    // Deduplicar y ordenar de mejor a peor farming score
    const seen = new Set<string>();
    const unique = mapped
      .filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
      .sort((a, b) => b.farmingScore - a.farmingScore);

    return NextResponse.json({ markets: unique, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
