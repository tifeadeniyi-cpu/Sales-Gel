"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/** Update URL search params (filters, sort, page, open record) without losing the others. */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = useCallback(
    (updates: Record<string, string | null | undefined>, opts: { resetPage?: boolean; scroll?: boolean; replace?: boolean } = {}) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (opts.resetPage) next.delete("page");
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      start(() => (opts.replace ? router.replace(url, { scroll: opts.scroll ?? false }) : router.push(url, { scroll: opts.scroll ?? false })));
    },
    [params, pathname, router],
  );
  return { params, set, pending };
}
