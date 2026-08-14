# SocialPilot API
#
# Multi-stage so the runtime image carries no compiler, no dev dependencies, and
# no source. The build context is the repository root, because the API depends
# on the @socialpilot/contracts workspace package and npm needs the whole
# workspace to resolve it.
#
#   docker build -f apps/api/Dockerfile -t socialpilot-api .

# ── deps ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Manifests only, so this layer is cached until a dependency actually changes.
# Copying source here would invalidate the install on every code edit.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/

# `--ignore-scripts` because contracts' `prepare` script compiles TypeScript,
# and the source is not in this layer yet.
RUN npm ci --ignore-scripts

# ── build ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

RUN npm run build --workspace @socialpilot/contracts
# `prisma generate` runs as part of the API's build script.
RUN npm run build --workspace @socialpilot/api

# Reinstall without dev dependencies, then regenerate the Prisma client — the
# prune removes it along with the CLI, and the runtime needs the generated
# client but not the compiler.
RUN npm ci --omit=dev --ignore-scripts \
 && npx --yes prisma@6 generate --schema apps/api/prisma/schema.prisma

# ── runtime ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Alpine's node image already has a `node` user. Running as root in a container
# means a container escape starts with root on the host namespace.
USER node

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma

EXPOSE 5000

# Hits the readiness endpoint, which touches the database — a process that is
# up but cannot reach Postgres should be reported unhealthy, not healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Direct node, no npm wrapper: npm does not forward SIGTERM to its child, so the
# graceful shutdown in server.ts would never run and in-flight requests would be
# killed mid-transaction.
CMD ["node", "apps/api/dist/server.js"]
