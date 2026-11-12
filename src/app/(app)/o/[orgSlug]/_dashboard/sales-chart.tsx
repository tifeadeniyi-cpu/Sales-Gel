"use client";
import { useEffect, useRef, useState } from "react";
import { useUrlParams } from "@/components/app/use-url-params";
import { NativeSelect } from "@/components/ui/input";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Validated pair (dataviz validator, light surface): current = brand blue, comparison = teal. */
const CURRENT = "#0053ee";
const COMPARE = "#0c9a8a";

export interface ChartData {
  metric: "revenue" | "orders";
  grouping: "hour" | "day" | "week" | "month";
  currency: string;
  current: { key: string; value: number }[];
  previous: { key: string; value: number }[] | null;
  total: number;
  previousTotal: number | null;
}

function keyLabel(key: string, g: ChartData["grouping"], long = false) {
  if (g === "hour") return key.slice(11);
  const d = new Date(`${key.slice(0, 10)}T12:00:00Z`);
  if (g === "month") return d.toLocaleDateString(undefined, { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });
  const s = d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  return g === "week" ? (long ? `Week of ${s}` : s) : s;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function SalesChart({ data, currencies, compareLabel, canRevenue = true }: { data: ChartData; currencies: string[]; compareLabel: string | null; canRevenue?: boolean }) {
  const { set } = useUrlParams();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmt = (v: number) => (data.metric === "revenue" ? formatMoney(v, data.currency) : v.toLocaleString());
  const fmtAxis = (v: number) => {
    if (data.metric === "orders") return v.toLocaleString();
    const digits = new Intl.NumberFormat(undefined, { style: "currency", currency: data.currency }).resolvedOptions().maximumFractionDigits ?? 2;
    const major = v / 10 ** digits;
    return new Intl.NumberFormat(undefined, { style: "currency", currency: data.currency, notation: "compact", maximumFractionDigits: 1 }).format(major);
  };
  const H = 240;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const n = data.current.length;
  const prev = data.previous;
  const allVals = [...data.current.map((p) => p.value), ...(prev ?? []).map((p) => p.value)];
  const minV = Math.min(0, ...allVals);
  const maxV = niceMax(Math.max(...allVals, 0));
  const x = (i: number) => pad.l + (n <= 1 ? (width - pad.l - pad.r) / 2 : (i * (width - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - (v - minV) / (maxV - minV || 1));
  const path = (pts: { value: number }[]) => pts.slice(0, n).map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${path(data.current)} L${x(n - 1).toFixed(1)},${y(Math.max(minV, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(minV, 0)).toFixed(1)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => minV + f * (maxV - minV));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - pad.l) / 72))));
  const change = data.previousTotal !== null && data.previousTotal !== 0 ? Math.round(((data.total - data.previousTotal) / Math.abs(data.previousTotal)) * 1000) / 10 : null;
  const empty = allVals.every((v) => v === 0);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = n <= 1 ? 0 : Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); }
    if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, (h ?? n) - 1)); }
    if (e.key === "Escape") setHover(null);
  };
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) / width, 0.12), 0.82) * 100;
  const groupWord = { hour: "Hourly", day: "Daily", week: "Weekly", month: "Monthly" }[data.grouping];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-3xl font-bold tracking-tight" data-testid="chart-total">{fmt(data.total)}</div>
          <div className="text-sm text-muted-foreground">
            {change !== null ? (
              <span className={cn("font-medium", change >= 0 ? "text-success" : "text-danger")}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}%</span>
            ) : null}
            {compareLabel && data.previousTotal !== null ? ` vs ${compareLabel.toLowerCase()} (${fmt(data.previousTotal)})` : `${groupWord} totals`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canRevenue && <div className="flex rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Chart metric">
            {(["revenue", "orders"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={data.metric === m} onClick={() => set({ metric: m === "revenue" ? null : m })}
                className={cn("rounded-md px-3 py-1 text-sm", data.metric === m ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:text-ink")}>
                {m === "revenue" ? "Revenue" : "Orders"}
              </button>
            ))}
          </div>}
          {data.metric === "revenue" && currencies.length > 1 && (
            <NativeSelect aria-label="Reporting currency" className="h-8 w-24 text-sm" value={data.currency} onChange={(e) => set({ currency: e.target.value })}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          )}
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTable((t) => !t)} aria-pressed={table}>{table ? "Show chart" : "Show table"}</button>
        </div>
      </div>
      {prev && !table && (
        <div className="mb-2 flex gap-4 text-xs text-muted-foreground" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: CURRENT }} /> Selected period</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: COMPARE }} /> {compareLabel}</span>
        </div>
      )}
      {table ? (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">{data.metric === "revenue" ? `Net revenue (${data.currency})` : "Orders"} by {data.grouping}</caption>
            <thead className="sticky top-0 bg-muted/80"><tr><th className="px-3 py-1.5 text-left font-medium">Period</th><th className="px-3 py-1.5 text-right font-medium">Selected</th>{prev && <th className="px-3 py-1.5 text-right font-medium">{compareLabel}</th>}</tr></thead>
            <tbody className="divide-y">
              {data.current.map((p, i) => (
                <tr key={p.key}><td className="px-3 py-1.5">{keyLabel(p.key, data.grouping, true)}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmt(p.value)}</td>{prev && <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{prev[i] ? fmt(prev[i].value) : "—"}</td>}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrap} className="relative">
          <svg
            width="100%"
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            role="img"
            aria-label={`${data.metric === "revenue" ? `Net revenue in ${data.currency}` : "Orders"}, ${groupWord.toLowerCase()}. Use left and right arrow keys to read values.`}
            tabIndex={0}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            className="touch-none select-none overflow-visible rounded-md focus-visible:outline-primary"
          >
            <defs>
              <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={CURRENT} stopOpacity="0.18" />
                <stop offset="100%" stopColor={CURRENT} stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--muted-foreground)">{fmtAxis(t)}</text>
              </g>
            ))}
            {data.current.map((p, i) => (i % labelEvery === 0 || i === n - 1) && (
              <text key={p.key} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">{keyLabel(p.key, data.grouping)}</text>
            ))}
            {!empty && <path d={area} fill="url(#salesFill)" />}
            {prev && <path d={path(prev)} fill="none" stroke={COMPARE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            <path d={path(data.current)} fill="none" stroke={CURRENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--muted-foreground)" strokeWidth={1} opacity={0.5} />
                {prev?.[hover] && <circle cx={x(hover)} cy={y(prev[hover].value)} r={4} fill={COMPARE} stroke="var(--card)" strokeWidth={2} />}
                <circle cx={x(hover)} cy={y(data.current[hover].value)} r={4.5} fill={CURRENT} stroke="var(--card)" strokeWidth={2} />
              </g>
            )}
          </svg>
          {empty && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground">No {data.metric === "revenue" ? "payments recorded" : "orders"} in this period yet.</p>}
          {hover !== null && (
            <div role="status" className="pointer-events-none absolute top-0 z-10 min-w-40 -translate-x-1/2 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg" style={{ left: `${tipLeft}%` }}>
              <div className="mb-1 text-muted-foreground">{keyLabel(data.current[hover].key, data.grouping, true)}</div>
              <div className="flex items-center gap-2"><span className="h-0.5 w-3 rounded" style={{ background: CURRENT }} /><span className="text-sm font-semibold tabular-nums">{fmt(data.current[hover].value)}</span></div>
              {prev?.[hover] && (
                <div className="mt-0.5 flex items-center gap-2 text-muted-foreground"><span className="h-0.5 w-3 rounded" style={{ background: COMPARE }} /><span className="tabular-nums">{fmt(prev[hover].value)}</span><span>· {keyLabel(prev[hover].key, data.grouping)}</span></div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
