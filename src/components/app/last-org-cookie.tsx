"use client";
import { useEffect } from "react";

/** Remembers the last visited org for the /o redirect. Not security relevant; membership is always re-checked. */
export function LastOrgCookie({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `crm_last_org=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);
  return null;
}
