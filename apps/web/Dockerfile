FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
# Next.js inlines NEXT_PUBLIC_* into the client bundle at build time, so it must be available
# before `next build` runs — setting it only at container runtime (as compose does for the API)
# would bake in the fallback below instead of the real value.
#
# The default is a *path*, not an origin, and that is what makes one published image work on
# every domain (audit finding PM-02): `/api` is correct whether the deployment answers on
# kurul.example.com or on localhost, so nothing about this build is deployment-specific and
# nobody has to rebuild the image to change their API URL. It relies on a reverse proxy in
# front of the stack routing `/api/*` to the API and everything else here — `docker/Caddyfile`
# ships one, and `docs/self-hosting.md` documents the contract for operators who bring their
# own. Server-side rendering cannot use a path (no origin to resolve against inside Node) and
# reads the runtime-settable `INTERNAL_API_URL` instead; see `apps/web/lib/api-url.ts` for the
# full split.
#
# Overriding this with an absolute origin still works, for a deployment that genuinely wants
# the API on its own domain — such a build is then specific to that domain, exactly as every
# build was before this default changed.
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Error tracking, same build-time rule and the same empty default. Empty is not merely
# "Sentry sends nothing": `instrumentation-client.ts` guards the dynamic import on this
# value, so an empty DSN means the SDK chunk is never emitted into a loaded path and a
# visitor's browser makes no third-party request. `SENTRY_AUTH_TOKEN` is intentionally *not*
# a build arg — see the source-map note in apps/web/next.config.ts and
# docs/development.md#observability.
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=
ARG NEXT_PUBLIC_SENTRY_RELEASE=
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_RELEASE=$NEXT_PUBLIC_SENTRY_RELEASE
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml prisma.config.ts ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/auth-access/package.json packages/auth-access/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @kurul/shared-types build \
  && pnpm --filter @kurul/auth-access build \
  && pnpm --filter @kurul/web build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Next.js standalone binds to $HOSTNAME, and Docker sets HOSTNAME to the container ID —
# leaving this unset makes server.js listen only on eth0, so the in-container healthcheck
# (wget against localhost) gets connection refused. 0.0.0.0 listens on every interface.
ENV HOSTNAME=0.0.0.0
# The npm and yarn CLIs the base image ships are removed here for the reasons written out beside
# the `runner` stage of apps/api/Dockerfile: nothing in this image runs either (the CMD is `node
# apps/web/server.js` over a Next.js standalone bundle), and npm's bundled dependencies are where
# every fixable HIGH/CRITICAL finding of the `image-scan` job came from.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
# Next.js standalone writes its ISR/image cache here at runtime — it must exist
# and be writable by the unprivileged `node` user (uid 1000) before dropping root.
RUN mkdir -p apps/web/.next/cache && chown -R node:node apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
