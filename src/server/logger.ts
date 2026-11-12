import pino from "pino";

/** Structured JSON logs. Include orgId/userId/requestId in child loggers where known. */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "commerce-crm" },
  redact: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.token"],
});
