import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db/client";
import { account, session, user, verification } from "./schema";

const https = (host?: string) => (host ? `https://${host}` : undefined);
// On Vercel, previews get their own hostnames; trust them alongside the configured base URL.
const vercelOrigins = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
  .map(https)
  .filter((o): o is string => !!o);

export const auth = betterAuth({
  appName: "SalesGel",
  baseURL: process.env.BETTER_AUTH_URL ?? https(process.env.VERCEL_PROJECT_PRODUCTION_URL),
  trustedOrigins: vercelOrigins,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true,
    // Email verification is enforced once a transactional email provider is connected (see docs/05-external-apis.md).
    requireEmailVerification: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: process.env.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT === "1",
    window: 60,
    max: 30,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "crm",
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
