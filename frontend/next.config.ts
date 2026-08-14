import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * The frontend is a standalone application. It has no workspace siblings to
 * transpile and no file tracing to widen — everything it needs is inside this
 * directory, which is what makes it independently deployable.
 */
const config: NextConfig = {
  reactStrictMode: true,

  // Emits a self-contained server bundle, which is what the Dockerfile's
  // runtime stage copies. Without it the image carries all of node_modules.
  output: "standalone",

  // Pinned to this directory. Left unset, Next walks up looking for a workspace
  // root, finds the repository's own package.json, and nests the output at
  // `.next/standalone/frontend/server.js` — which silently breaks the
  // Dockerfile's CMD path. The frontend is self-contained, so its tracing root
  // is itself.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),

  typescript: {
    ignoreBuildErrors: false,
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },

  images: {
    // Instagram serves avatars from its own CDN. Restricted to those hosts
    // rather than opened up, so the optimizer cannot be aimed elsewhere.
    remotePatterns: [
      { protocol: "https", hostname: "*.cdninstagram.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
    ],
  },
};

export default config;
