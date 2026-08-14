# SocialPilot web
#
# Built from the repository root so the @socialpilot/contracts workspace
# resolves:
#
#   docker build -f apps/web/Dockerfile -t socialpilot-web .

FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/web/package.json ./apps/web/

RUN npm ci --ignore-scripts

FROM node:22-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web

# NEXT_PUBLIC_* values are inlined into the client bundle at build time, not
# read at runtime — so the API URL has to be supplied here, and a different
# environment needs a different image. That is a real constraint of the
# framework rather than a choice; see docs/deployment.md.
ARG NEXT_PUBLIC_API_URL=http://localhost:5000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

RUN npm run build --workspace @socialpilot/contracts
RUN npm run build --workspace @socialpilot/web

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
USER node

# Next's standalone output bundles only the files actually reached, which keeps
# the runtime image far smaller than copying node_modules wholesale.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
