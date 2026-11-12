import type { z } from "zod";
import { ValidationError } from "./errors";

/** Parses input with a Zod schema, throwing a ValidationError with per-field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  throw new ValidationError("Please fix the highlighted fields.", fieldErrors);
}
