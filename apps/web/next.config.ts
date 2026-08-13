import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  // The shared contracts package ships TypeScript-compiled ESM from a workspace
  // sibling; Next has to transpile it rather than treat it as a prebuilt
  // node_modules dependency.
  transpilePackages: ["@socialpilot/contracts"],

  // Next 16 no longer runs ESLint as part of `next build` — linting is its own
  // step (`npm run lint`) and the config key was removed with it.

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
          // The app needs no camera, microphone, or location; denying them
          // outright means a future dependency cannot quietly ask.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },

  images: {
    // Instagram serves avatars from its own CDN. Restricted to that host rather
    // than opened up, so the optimizer cannot be pointed at arbitrary origins.
    remotePatterns: [
      { protocol: "https", hostname: "*.cdninstagram.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
    ],
  },
};

export default config;
