"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ProcessedMarket } from "./api/markets/route";

// ── Constantes ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_SEC = 300; // 5 minutos

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVol(v: number) {
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return "$" + Math.round(v / 1_000) + "K";
  return "$" + Math.round(v);
}

function fmtDays(d: number) {
  if (d < 1 / 24) return "< 1h";
  if (d < 1) return Math.round(d * 24) + "h";
  return d.toFixed(1) + "d";
}

function fmtGain(prob: number) {
  return ((1 / prob - 1) * 100).toFixed(1) + "%";
}

function fmtPct(p: number) {
  return Math.round(p * 100) + "%";
}

function fmtPriceChange(delta: number) {
  const sign = delta >= 0 ? "+" : "";
  return sign + (delta * 100).toFixed(1) + "%";
}

function fmtCountdown(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type SortKey = "prob" | "days" | "volume" | "gain";

interface Filters {
  minProb: number;
  maxDays: number;
  minVol: number;
  category: string;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function Home() {
  const [filters, setFilters] = useState<Filters>({
    minProb: 0.9,
    maxDays: 2,
    minVol: 1000,
    category: "",
  });

  const [markets, setMarkets] = useState<ProcessedMarket[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<string[]>([]);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("prob");
  const [searched, setSearched] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_SEC);
  const [alertCount, setAlertCount] = useState(0);

  const prevIdsRef = useRef<Set<string>>(new Set());
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchMarkets = useCallback(async (isAutoRefresh = false) => {
    setLoading(true);
    setError(null);
    const f = filtersRef.current;

    try {
      const qs = new URLSearchParams({
        minProb: String(f.minProb),
        maxDays: String(f.maxDays),
        minVol: String(f.minVol),
        ...(isAutoRefresh ? { t: String(Date.now()) } : {}),
      });

      const res = await fetch(`/api/markets?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error desconocido");

      const incoming: ProcessedMarket[] = data.markets;
      const incomingIds = new Set(incoming.map((m) => m.id));

      // Detectar nuevos mercados en auto-refresh
      if (isAutoRefresh && prevIdsRef.current.size > 0) {
        const detected = new Set(
          incoming
            .filter((m) => !prevIdsRef.current.has(m.id))
            .map((m) => m.id)
        );
        setNewIds(detected);
        if (detected.size > 0) {
          setAlertCount((c) => c + detected.size);
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            new Notification("Polymarket Sniper", {
              body: `${detected.size} nuevo${detected.size > 1 ? "s" : ""} mercado${detected.size > 1 ? "s" : ""} detectado${detected.size > 1 ? "s" : ""}`,
            });
          }
        } else {
          setNewIds(new Set());
        }
      } else {
        setNewIds(new Set());
      }

      prevIdsRef.current = incomingIds;

      if (data.categories?.length) {
        setCategories(data.categories);
      }

      // Filtrar por categoría en el cliente
      const filtered =
        f.category
          ? incoming.filter((m) => m.category === f.category)
          : incoming;

      setMarkets(filtered);
      setFetchedAt(data.fetchedAt);
      setSearched(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Auto-refresh timer ────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoRefresh || !searched) return;
    setCountdown(REFRESH_INTERVAL_SEC);

    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchMarkets(true);
          return REFRESH_INTERVAL_SEC;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [autoRefresh, searched, fetchMarkets]);

  const handleAutoRefreshToggle = () => {
    const next = !autoRefresh;
    setAutoRefresh(next);
    if (
      next &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  };

  // ── Ordenar ───────────────────────────────────────────────────────────────

  const sorted = [...markets].sort((a, b) => {
    if (sortKey === "prob") return b.bestProb - a.bestProb;
    if (sortKey === "days") return a.daysLeft - b.daysLeft;
    if (sortKey === "volume") return b.volume - a.volume;
    if (sortKey === "gain") return 1 / a.bestProb - 1 / b.bestProb;
    return 0;
  });

  const avgProb =
    markets.length
      ? markets.reduce((s, m) => s + m.bestProb, 0) / markets.length
      : 0;
  const totalVol = markets.reduce((s, m) => s + m.volume, 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "2rem 1rem" }}>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>
            Polymarket Sniper
            {alertCount > 0 && (
              <span
                onClick={() => setAlertCount(0)}
                title="Clic para resetear"
                style={{
                  marginLeft: 10,
                  fontSize: 12,
                  background: "#FAECE7",
                  color: "#993C1D",
                  border: "0.5px solid #F0997B",
                  borderRadius: 99,
                  padding: "2px 10px",
                  verticalAlign: "middle",
                  cursor: "pointer",
                }}
              >
                +{alertCount} nuevo{alertCount > 1 ? "s" : ""}
              </span>
            )}
          </h1>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
            Mercados de alta probabilidad próximos a resolverse.
            {fetchedAt && (
              <span>
                {" "}Actualizado:{" "}
                {new Date(fetchedAt).toLocaleTimeString("es-ES", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </p>
        </div>

        {/* Auto-refresh toggle */}
        {searched && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            {autoRefresh && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                Refresca en {fmtCountdown(countdown)}
              </span>
            )}
            <button
              onClick={handleAutoRefreshToggle}
              style={{
                fontSize: 12,
                padding: "5px 12px",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: 99,
                background: autoRefresh ? "#EAF3DE" : "var(--color-background-primary)",
                color: autoRefresh ? "#3B6D11" : "var(--color-text-primary)",
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
              }}
            >
              {autoRefresh ? "● Auto-refresh ON" : "Auto-refresh OFF"}
            </button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          background: "var(--color-background-secondary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <FilterSelect
          label="Probabilidad mínima"
          value={filters.minProb}
          onChange={(v) => setFilters((f) => ({ ...f, minProb: v }))}
          options={[
            { label: "85%+", value: 0.85 },
            { label: "90%+", value: 0.9 },
            { label: "93%+", value: 0.93 },
            { label: "95%+", value: 0.95 },
            { label: "97%+", value: 0.97 },
          ]}
        />
        <FilterSelect
          label="Cierra en"
          value={filters.maxDays}
          onChange={(v) => setFilters((f) => ({ ...f, maxDays: v }))}
          options={[
           { label: "≤ 1 día", value: 1 },
{ label: "≤ 2 días", value: 2 },
{ label: "≤ 7 días", value: 7 },
{ label: "≤ 14 días", value: 14 },
{ label: "≤ 30 días", value: 30 },
          ]}
        />
        <FilterSelect
          label="Volumen mínimo"
          value={filters.minVol}
          onChange={(v) => setFilters((f) => ({ ...f, minVol: v }))}
          options={[
            { label: "Cualquiera", value: 0 },
            { label: "$1,000+", value: 1000 },
            { label: "$10,000+", value: 10000 },
            { label: "$50,000+", value: 50000 },
            { label: "$100,000+", value: 100000 },
          ]}
        />

        {/* Categoría — se puebla con datos reales de la API */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 12,
              color: "var(--color-text-secondary)",
              marginBottom: 6,
            }}
          >
            Categoría
          </label>
          <select
            value={filters.category}
            onChange={(e) =>
              setFilters((f) => ({ ...f, category: e.target.value }))
            }
            style={{
              width: "100%",
              padding: "6px 8px",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              background: "var(--color-background-primary)",
              color: "var(--color-text-primary)",
              fontSize: 13,
              fontFamily: "var(--font-sans)",
            }}
          >
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            onClick={() => fetchMarkets(false)}
            disabled={loading}
            style={{
              width: "100%",
              padding: "8px 16px",
              border: "0.5px solid var(--color-border-secondary)",
              borderRadius: "var(--border-radius-md)",
              background: loading
                ? "var(--color-background-secondary)"
                : "var(--color-background-primary)",
              color: "var(--color-text-primary)",
              fontSize: 13,
              cursor: loading ? "default" : "pointer",
              fontFamily: "var(--font-sans)",
            }}
          >
            {loading ? "Buscando..." : "Buscar ↗"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "var(--color-background-danger)",
            color: "var(--color-text-danger)",
            borderRadius: "var(--border-radius-md)",
            fontSize: 13,
            marginBottom: "1rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Métricas */}
      {searched && !loading && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            marginBottom: "1.5rem",
          }}
        >
          <Metric label="Mercados" value={String(markets.length)} />
          <Metric
            label="Prob. media"
            value={markets.length ? fmtPct(avgProb) : "—"}
          />
          <Metric
            label="Volumen total"
            value={totalVol > 0 ? fmtVol(totalVol) : "—"}
          />
          <Metric
            label="Ganancia media"
            value={
              markets.length
                ? ((1 / avgProb - 1) * 100).toFixed(1) + "%"
                : "—"
            }
          />
        </div>
      )}

      {/* Sort bar */}
      {sorted.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            Ordenar:
          </span>
          {(
            [
              ["prob", "Probabilidad"],
              ["days", "Tiempo restante"],
              ["volume", "Volumen"],
              ["gain", "Ganancia"],
            ] as [SortKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortKey(key)}
              style={{
                fontSize: 12,
                padding: "3px 10px",
                border: "0.5px solid var(--color-border-secondary)",
                borderRadius: 99,
                background:
                  sortKey === key
                    ? "var(--color-background-secondary)"
                    : "var(--color-background-primary)",
                color: "var(--color-text-primary)",
                cursor: "pointer",
                fontFamily: "var(--font-sans)",
                fontWeight: sortKey === key ? 500 : 400,
              }}
            >
              {label}
            </button>
          ))}

          {newIds.size > 0 && (
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "#993C1D",
                background: "#FAECE7",
                border: "0.5px solid #F0997B",
                borderRadius: 99,
                padding: "3px 10px",
              }}
            >
              {newIds.size} nuevo{newIds.size > 1 ? "s" : ""} en este refresh
            </span>
          )}
        </div>
      )}

      {/* Lista */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              color: "var(--color-text-secondary)",
              fontSize: 14,
            }}
          >
            Consultando Polymarket...
          </div>
        )}

        {!loading && searched && sorted.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "2rem",
              color: "var(--color-text-secondary)",
              fontSize: 14,
            }}
          >
            No se encontraron mercados. Prueba a ampliar los filtros.
          </div>
        )}

        {!loading &&
          sorted.map((m) => (
            <MarketCard key={m.id} market={m} isNew={newIds.has(m.id)} />
          ))}
      </div>
    </main>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  options: { label: string; value: number }[];
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 12,
          color: "var(--color-text-secondary)",
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          width: "100%",
          padding: "6px 8px",
          border: "0.5px solid var(--color-border-secondary)",
          borderRadius: "var(--border-radius-md)",
          background: "var(--color-background-primary)",
          color: "var(--color-text-primary)",
          fontSize: 13,
          fontFamily: "var(--font-sans)",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--color-background-secondary)",
        borderRadius: "var(--border-radius-md)",
        padding: "0.75rem 1rem",
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: "var(--color-text-primary)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-text-secondary)",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function MarketCard({
  market: m,
  isNew,
}: {
  market: ProcessedMarket;
  isNew: boolean;
}) {
  const pct = Math.round(m.bestProb * 100);
  const isVeryHigh = pct >= 95;
  const url = `https://polymarket.com/event/${m.slug}`;

  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: isNew
          ? "2px solid #F0997B"
          : "0.5px solid var(--color-border-tertiary)",
        borderRadius: "var(--border-radius-lg)",
        padding: "1rem 1.25rem",
        position: "relative",
      }}
    >
      {isNew && (
        <span
          style={{
            position: "absolute",
            top: -10,
            left: 16,
            fontSize: 10,
            fontWeight: 500,
            background: "#993C1D",
            color: "#fff",
            borderRadius: 99,
            padding: "2px 8px",
            letterSpacing: "0.04em",
          }}
        >
          NUEVO
        </span>
      )}

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 56,
            height: 56,
            borderRadius: "var(--border-radius-md)",
            background: isVeryHigh ? "#D1EAC6" : "#EAF3DE",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 500, color: "#3B6D11" }}>
            {pct}%
          </span>
          <span style={{ fontSize: 10, color: "#639922" }}>
            {m.bestOutcomeName}
          </span>
        </div>

        <div style={{ flex: 1 }}>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-primary)",
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {m.question}
          </p>
          {m.oneDayPriceChange !== 0 && (
            <span
              style={{
                fontSize: 11,
                color: m.oneDayPriceChange > 0 ? "#3B6D11" : "#993C1D",
                marginTop: 4,
                display: "inline-block",
              }}
            >
              {fmtPriceChange(m.oneDayPriceChange)} hoy
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <Tag color="orange">cierra en {fmtDays(m.daysLeft)}</Tag>
        <Tag color="blue">{fmtVol(m.volume)} vol.</Tag>
        {m.volume24hr > 0 && (
          <Tag color="gray">{fmtVol(m.volume24hr)} / 24h</Tag>
        )}
        {m.category && <Tag color="gray">{m.category}</Tag>}

        <span
          style={{
            marginLeft: "auto",
            fontSize: 12,
            color: "var(--color-text-secondary)",
          }}
        >
          Ganancia si acierta:{" "}
          <strong style={{ color: "#3B6D11" }}>+{fmtGain(m.bestProb)}</strong>
        </span>

        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 11,
            color: "var(--color-text-secondary)",
            textDecoration: "none",
            padding: "2px 8px",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-md)",
          }}
        >
          Ver en Polymarket ↗
        </a>
      </div>

      {m.bestBid > 0 && m.bestAsk > 0 && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--color-text-secondary)",
            borderTop: "0.5px solid var(--color-border-tertiary)",
            paddingTop: 8,
          }}
        >
          Bid: {fmtPct(m.bestBid)} · Ask: {fmtPct(m.bestAsk)} · Spread:{" "}
          {(m.spread * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

function Tag({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "orange" | "blue" | "gray";
}) {
  const styles: Record<string, React.CSSProperties> = {
    orange: { background: "#FAECE7", color: "#993C1D", borderColor: "#F0997B" },
    blue: { background: "#E6F1FB", color: "#185FA5", borderColor: "#85B7EB" },
    gray: {
      background: "var(--color-background-secondary)",
      color: "var(--color-text-secondary)",
      borderColor: "var(--color-border-tertiary)",
    },
  };
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 99,
        border: "0.5px solid",
        ...styles[color],
      }}
    >
      {children}
    </span>
  );
}
