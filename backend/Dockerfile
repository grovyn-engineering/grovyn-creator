# Backend image.
#
# Docker is entirely optional for this project — development runs on the host
# against Supabase, with no local database. This exists for deployment.
#
# The build context is this directory, not the repository root: the backend has
# no workspace siblings any more, which is what makes it independently
# deployable.
#
#   docker build -t instagram-saas-backend ./backend

# ── deps ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Manifests only, so this layer stays cached until a dependency actually
# changes. Copying source here would reinstall on every code edit.
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ── build ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# `prisma generate` runs as part of the build script.
RUN npm run build

# Reinstall without dev dependencies, then regenerate the client — the prune
# removes it along with the CLI, and the runtime needs the generated client but
# not the compiler.
RUN npm ci --omit=dev --ignore-scripts \
 && npx --yes prisma@6 generate

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# The node image already provides this user. Running as root means a container
# escape starts with root on the host namespace.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/prisma ./prisma

EXPOSE 5000

# Hits the readiness endpoint, which touches the database — a process that is
# up but cannot reach Postgres should report unhealthy, not healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Direct node, not npm: npm does not forward SIGTERM to its child, so the
# graceful shutdown in server.ts would never run and in-flight requests would be
# killed mid-transaction.
CMD ["node", "dist/server.js"]
