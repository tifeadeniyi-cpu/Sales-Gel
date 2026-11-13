/** Public base URL of the app (webhooks, OAuth redirects, payment return pages). */
export function appUrl() {
  const u =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return u.replace(/\/$/, "");
}
