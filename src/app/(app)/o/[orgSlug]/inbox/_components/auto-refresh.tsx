"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the inbox every few seconds while the tab is visible, so new messages appear. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
