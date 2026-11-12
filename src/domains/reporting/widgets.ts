/** Dashboard widget catalog (client-safe). Order here is the built-in default layout. */
export const WIDGETS = [
  { key: "sales", label: "Sales Performance", width: "half" },
  { key: "pipeline", label: "Sales Pipeline", width: "half" },
  { key: "inbox", label: "Inbox Preview", width: "half" },
  { key: "followups", label: "My Follow-ups", width: "half" },
  { key: "orders", label: "Recent Orders", width: "half" },
  { key: "support", label: "Support Overview", width: "half" },
  { key: "activity", label: "Recent Activity", width: "full" },
] as const;
export type WidgetKey = (typeof WIDGETS)[number]["key"];
export interface WidgetPref { key: WidgetKey; visible: boolean; width: "half" | "full" }
export const DEFAULT_LAYOUT: WidgetPref[] = WIDGETS.map((w) => ({ key: w.key, visible: true, width: w.width }));

/** Normalizes stored prefs: drops unknown keys, appends widgets added since the layout was saved. */
export function normalizeLayout(raw: unknown): WidgetPref[] {
  const known = new Set<string>(WIDGETS.map((w) => w.key));
  const seen = new Set<string>();
  const out: WidgetPref[] = [];
  if (Array.isArray(raw)) {
    for (const r of raw) {
      if (!r || typeof r !== "object") continue;
      const { key, visible, width } = r as Record<string, unknown>;
      if (typeof key !== "string" || !known.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ key: key as WidgetKey, visible: visible !== false, width: width === "full" ? "full" : "half" });
    }
  }
  for (const d of DEFAULT_LAYOUT) if (!seen.has(d.key)) out.push(d);
  return out;
}
