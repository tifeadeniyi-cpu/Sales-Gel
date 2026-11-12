import type { NextConfig } from "next";

// Cache Components is intentionally disabled: nearly every screen is per-tenant
// and per-user, so we render dynamically and keep tenant data out of shared caches.
// See docs/00-architecture.md → "Rendering model".
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: false,
  experimental: {
    authInterrupts: true,
    // Ticket attachments: Vercel caps request bodies at 4.5 MB, so uploads are limited to 4 MB per message.
    serverActions: { bodySizeLimit: "4.5mb" },
    proxyClientMaxBodySize: "4.5mb",
  },
  serverExternalPackages: ["pino", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
