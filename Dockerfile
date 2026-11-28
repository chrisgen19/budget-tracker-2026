# Multi-stage standalone build for Coolify (Build Pack: Dockerfile).
#
# Why a Dockerfile: the Railpack build kept every layer and cost about 4 GB of disk per deploy.
# Here the install layer is cached by the lockfile and the runtime image carries only the
# standalone server (`output: "standalone"` in next.config.ts).
#
# Secrets: the only build ARG is DATABASE_URL, in the build stage, because the build command
# migrates and checks drift against the database. No other ARG may be added: Coolify turns every
# environment variable into a build ARG when "Inject Build Args to Dockerfile" is on, so that
# toggle MUST be off for this app. DATABASE_URL then arrives as a plain build-time variable and
# is not baked into the runtime image. scripts/build-scripts.test.ts guards these rules.
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
