# Multi-stage standalone build for Coolify (Build Pack: Dockerfile).
#
# Why a Dockerfile: the Railpack build kept every layer and cost about 4 GB of disk per deploy.
# Here the install layer is cached by the lockfile and the runtime image carries only the
# standalone server (`output: "standalone"` in next.config.ts).
#
# Secrets: the build stage declares DATABASE_URL, because the build command migrates and checks
# drift against the database, and COOLIFY_BUILD_SECRETS_HASH (see the build stage). No other ARG
# may be added: Coolify always
# passes `--build-arg KEY` for every build-time variable (secrets included), and any ARG declared
# here with a matching name would receive the real value and record it in the image history.
# "Inject Build Args to Dockerfile" only decides whether Coolify inserts an ARG for each of them
# after every FROM, so that toggle MUST be off. scripts/build-scripts.test.ts guards the ARG rule.
#
# Base is Debian slim, not alpine: Prisma's engines want glibc and openssl.

FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Dependencies: only the files that decide them, so this layer survives every source change.
FROM base AS deps
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm install --frozen-lockfile

# Build: migrates, checks drift, then runs next build (all inside build:deploy).
FROM deps AS build
ARG DATABASE_URL
COPY . .
# Coolify's hash of every build-time variable, keyed with its APP_KEY, so not a secret. It is part
# of the cache key of the RUN below: change any Coolify variable and redeploy, and build:deploy
# runs again (migrations and the drift check) instead of coming from the layer cache. Railpack
# got the same hash as `secrets-hash`. Declared here, after the deps stage, so the install layer
# stays cached.
ARG COOLIFY_BUILD_SECRETS_HASH
RUN pnpm build:deploy

# Runtime: curl and wget are needed by the Coolify Scheduled Tasks and health check,
# openssl by Prisma.
FROM base AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl wget \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd -g 1001 nodejs \
  && useradd -u 1001 -g nodejs -M nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
RUN mkdir -p .next/cache && chown nextjs:nodejs .next/cache
USER nextjs
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
