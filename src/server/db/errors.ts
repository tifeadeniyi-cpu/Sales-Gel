type PgLike = { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };

function pgError(err: unknown): PgLike | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const e = cur as PgLike;
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e;
    cur = e.cause;
  }
  return null;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  if (!e || e.code !== "23505") return false;
  return !constraint || e.constraint_name === constraint || e.constraint === constraint;
}

export function isForeignKeyViolation(err: unknown): boolean {
  return pgError(err)?.code === "23503";
}

/** 42501 insufficient_privilege: missing GRANT or RLS WITH CHECK failure. */
export function isPermissionDenied(err: unknown): boolean {
  return pgError(err)?.code === "42501";
}
