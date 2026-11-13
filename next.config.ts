import type { NextConfig } from "next";

// Cache Components is intentionally disabled: nearly every screen is per-tenant
// and per-user, so we render dynamically and keep tenant data out of shared caches.
// See docs/00-architecture.md → "Rendering model".
const baseHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];
const securityHeaders = [...baseHeaders, { key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }];
// The web chat window is embedded on customers' own websites, so only /chat/* may be framed.
const chatHeaders = [...baseHeaders, { key: "Content-Security-Policy", value: "frame-ancestors *" }];

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
    return [
      { source: "/((?!chat/).*)", headers: securityHeaders },
      { source: "/chat/:path*", headers: chatHeaders },
    ];
  },
};

export default nextConfig;
