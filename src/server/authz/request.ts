import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { loadOrgContext, type OrgContext } from "./context";

/**
 * Request-bound org context for pages, layouts and server actions.
 * Validates the session AND active membership server-side; non-members get 404.
 */
export const requireOrgContext = cache(async (orgSlug: string): Promise<OrgContext> => {
  const user = await requireUser();
  const ctx = await loadOrgContext(user.id, orgSlug);
  if (!ctx) notFound();
  const h = await headers();
  return {
    ...ctx,
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  };
});
