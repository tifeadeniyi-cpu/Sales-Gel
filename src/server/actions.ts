import "server-only";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "./errors";
import { logger } from "./logger";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export const initialActionState: ActionResult<never> | null = null;

/**
 * Wraps a server action body so domain errors become structured, user-readable results
 * (validation messages per field, 403/404 explanations) instead of crashing the page.
 * Unknown errors are logged and returned as a generic message.
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (err) {
    unstable_rethrow(err); // let redirect()/notFound() propagate
    if (err instanceof AppError) {
      return { ok: false, error: err.message, code: err.code, fieldErrors: err.fieldErrors };
    }
    logger.error({ err }, "unhandled action error");
    return { ok: false, error: "Something went wrong. Please try again.", code: "internal" };
  }
}

/** Reads a string from FormData, returning undefined for empty values. */
export function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}
