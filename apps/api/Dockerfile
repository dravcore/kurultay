FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS build
# prisma.config.ts eagerly reads DATABASE_URL (via env()) as soon as it's loaded, which
# happens for `prisma generate` too even though generation never connects to a database.
# This placeholder only needs to be well-formed, never a real, reachable database.
ARG DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"
ENV DATABASE_URL=$DATABASE_URL
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml prisma.config.ts ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/auth-access/package.json packages/auth-access/
RUN pnpm install --frozen-lockfile
COPY . .
# Two deploy directories, both pruned by `scripts/prune-deployed-modules.mjs` — read its header
# for why `pnpm deploy --prod` alone leaves ~500 MB of optional peer dependencies behind. Both
# prunes happen here, in the throwaway build stage, so neither shipped image pays for the
# intermediate.
#
# `/app/deploy` is the API runtime: a production deploy, pruned to what the process can resolve.
# `/app/migrate` is the migration runner: a full (dev-inclusive) deploy — `prisma` is a
# devDependency of `@kurul/api` — narrowed to the Prisma CLI and the one module
# `prisma.config.ts` imports. Nest, Jest and the TypeScript compiler do not survive that filter.
RUN pnpm --filter @kurul/shared-types build \
  && pnpm --filter @kurul/auth-access build \
  && pnpm db:generate \
  && pnpm --filter @kurul/api build \
  && pnpm --filter @kurul/api deploy --prod /app/deploy \
  && node scripts/prune-deployed-modules.mjs /app/deploy \
  && pnpm --filter @kurul/api deploy /app/migrate \
  && node scripts/prune-deployed-modules.mjs /app/migrate prisma dotenv

# One-shot migration runner, invoked as its own compose service and never as part of the app's
# runtime. It used to be `FROM build` — the entire assembled workspace, every dev dependency of
# every package in it, and pnpm itself, 2.66 GB of image to run one command. It now starts from
# the same clean base the API does and carries the Prisma CLI, the schema and the migrations,
# which is the whole of what `migrate deploy` reads.
#
# `prisma` is invoked directly rather than through `pnpm db:migrate`: with the workspace gone
# there is no root package.json to hold that script, and no reason to ship a package manager into
# an image that installs nothing. The arguments are the same ones that script expands to.
FROM node:24-alpine AS migrate
WORKDIR /app
ENV NODE_ENV=production
# Same removal, same reasons, written out beside the `runner` stage below. This stage invokes the
# Prisma CLI through `node_modules/.bin`, so it needs a package manager no more than the API does.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /app/migrate/node_modules ./node_modules
# The schema and migrations are read from the paths `prisma.config.ts` names, so the config file
# and the layout under it have to match the repository's.
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /app/apps/api/prisma ./apps/api/prisma
# Non-root here too. The previous `migrate` stage inherited no USER from `build` and so ran as
# root; `prisma migrate deploy` opens a socket to postgres and reads files it does not own, so
# nothing about it needed root — the stage simply never dropped it.
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# node:24-alpine ships two package managers, npm and yarn, and none of the three images built
# from these Dockerfiles ever runs either: every CMD is `node`, and the dependencies are copied
# in already resolved. They are removed here for two reasons. The first is ordinary hardening: a
# tool that can fetch and execute arbitrary code is the last thing a production container should
# hand to somebody who has just found a way to run one command in it. The second is what made it
# urgent. Measured on 2026-08-22 against the new `image-scan` job in .github/workflows/ci.yml,
# npm's own bundled dependencies (`tar`, `brace-expansion`, `ip-address`, `undici`) accounted for
# **every one** of the eight fixable HIGH/CRITICAL findings in all three images, and nothing in
# this repository can close them: they are fixed when the Node project cuts an image with a newer
# bundled npm and not before. Kept, they would leave a required check permanently red over
# something no pull request could act on, which is how a security gate turns into a formality
# everybody clicks past.
#
# `corepack` stays. It is the shim that *enables* a package manager rather than one itself, it is
# what the build stages above go through, and it carries no bundled dependency tree to be
# advised about.
#
# None of this makes the image smaller: the files live in the base image's own layer, so a later
# `rm` writes a whiteout rather than saving anything. What it removes is the binaries from the
# running container, and their advisories from any scan of it.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build --chown=node:node /app/deploy/dist ./dist
COPY --from=build --chown=node:node /app/deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /app/deploy/package.json ./package.json
# Attachments are written here at runtime (STORAGE_PATH, docker-compose.yml) — the first
# writable path this image has ever needed. It must exist and be owned by the unprivileged
# `node` user (uid 1000) *before* root is dropped, because an empty named volume mounted over
# a path takes the ownership of the mount point it finds in the image: create it here and the
# volume comes up `node:node`, leave it out and Docker creates it `root:root` and every upload
# fails with EACCES. Creating it in the image rather than chowning at boot is also what keeps
# docker-compose.yml's "never chowns" claim — and with it `cap_drop: [ALL]` — true. Same shape
# as apps/web/Dockerfile's .next/cache.
RUN mkdir -p /data/attachments && chown -R node:node /data
# Run as the unprivileged `node` user (uid 1000) shipped with node:24-alpine.
# dist + node_modules are read-only at runtime; /data above is the one writable path.
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
