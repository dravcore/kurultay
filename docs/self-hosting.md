# Self-hosting Kurul on your own domain

Put Kurul on a server, on your domain, with HTTPS and working email. Everything below is
one page on purpose; budget about an hour, most of it waiting for DNS.

> 🌐 English (canonical) | [Türkçe](tr/self-hosting.md)

There is no build step. `docker compose pull` fetches images published for every release, and
the same image works on every domain — the API URL is not compiled into it (see
[Why there is no rebuild](#why-there-is-no-rebuild) if you want the reasoning).

> **Installing v0.2.0? Use `git clone` instead.** Releases up to and including v0.2.0
> published only the `api` and `web` images; the third one this page pulls, `kurul-migrate`,
> exists from the first release after v0.2.0 onward. The download step below fetches no source
> tree to build it from, so on v0.2.0 the steps on this page cannot start the stack — install
> from a clone as shown in [Troubleshooting](#troubleshooting), and come back to this page
> from the next release on.

## What you need

- A server with a public IP, Docker Engine 24+ and the Compose plugin. Two CPUs and 2 GB of
  RAM is enough for a small team — see [Server sizing](#server-sizing) for how that 2 GB is
  actually spent.
- A domain you control, with **ports 80 and 443 open** to that server. Both are required:
  Let's Encrypt validates over port 80, browsers use 443.
- An SMTP account. Kurul needs outgoing mail before anyone can accept an invitation — see
  [Email](#email-smtp) for why, and what happens if you skip it.
- A host firewall that allows nothing inbound beyond SSH, 80 and 443. Everything else this
  stack runs stays off the public internet on its own: `proxy` is the only service in
  `docker-compose.yml` with a `ports:` entry, so Postgres, Redis, the API and the web app are
  reachable only over Docker's internal network. `docker compose ps` is how you confirm that on
  your own machine — every row except `proxy` should show a bare container port
  (`4000/tcp`, `5432/tcp`, …) with no `0.0.0.0:` mapping in front of it.

  The firewall still earns its place, for one reason worth knowing before you trust it: on
  Linux, Docker publishes ports by writing its own iptables rules, and those are consulted
  _before_ ufw's. A container port you publish — in a `docker-compose.override.yml`, say, to
  "temporarily" reach Postgres — is exposed to the internet even with `ufw deny 5432` in place.
  The firewall protects the things Docker is not managing; the `ports:` list is what protects
  the rest, which is why this stack keeps it to one service.

## Server sizing

Every service in `docker-compose.yml` carries a `mem_limit` (OPS-05, 2026-08-18 audit). Before
this, nothing capped how much memory any one container could take, so on a host near its 2 GB
budget the _kernel_ OOM killer picked which process died — it scores every process on the host,
not just this stack's, and has no reason to spare Postgres over whichever container actually
grew. A `mem_limit` puts that decision back where it belongs: a container is only ever killed
for outgrowing its own ceiling, and nothing another service does can take Postgres down with it.

| Service    | `mem_limit` | Why this number                                                                                 |
| ---------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `postgres` | 512m        | Generous baseline for a small-team board's working set                                          |
| `api`      | 512m        | `REQUEST_BODY_MAX_BYTES` / `ATTACHMENT_MAX_BYTES` (`.env.example`) both buffer into its heap    |
| `web`      | 512m        | Same Next.js SSR process, same "no ceiling chosen" problem as `api`                             |
| `migrate`  | 512m        | Matches `api` — same build stage, same Prisma CLI, just once at startup                         |
| `backup`   | 256m        | `pg_dump` streams rather than buffering; this covers process overhead and the attachments `tar` |
| `redis`    | 128m        | Cache, sessions, rate limits, notifications only — never board data, small bounded working set  |
| `proxy`    | 128m        | Terminates TLS and proxies; bodies pass through Caddy rather than buffering into it             |

`api` and `web` also set `NODE_OPTIONS=--max-old-space-size=384` — 75% of their 512m ceiling —
so V8's heap is pinned explicitly rather than left to Node's own container-memory heuristic. The
remaining 128m of headroom below `mem_limit` is for what a heap ceiling alone doesn't cover
(thread stacks, native buffers, code space): V8 hits its own catchable "JavaScript heap out of
memory" before the cgroup's hard limit does, which shows up as a line in `docker compose logs
api` (or `web`) instead of a bare `SIGKILL`.

These are ceilings, not reservations — a container using less than its `mem_limit` costs nothing
extra, and `migrate` in particular exits (successfully) before `api` and `web` finish starting,
so it is never actually concurrent with them. Summed as if every long-running service hit its
ceiling at once — `postgres` + `api` + `web` + `redis` + `proxy` + `backup`, excluding `migrate`,
which by the time the others are up has already exited — that is 512 + 512 + 512 + 128 + 128 +
256 = 2048 MB, which is exactly the 2 GB this page has always asked for. A host with less
headroom than that under real traffic is a reason to raise these numbers (`docker-compose.yml`
is a plain edit, or override them in a `docker-compose.override.yml`) or the box's own RAM, not
to remove the ceiling — see the note above for what removing it gets you back.

**Not verified by measurement**: these numbers come from the request/attachment ceilings already
documented in `.env.example` and from V8's own heap-sizing conventions, not from running the
stack under load at each limit. If a container is killed for hitting its `mem_limit` in
practice, `docker compose ps` shows it exited (often `137`), and `docker compose logs <service>`
is the place to start — raise that one service's limit rather than every service's.

## 1. DNS

Point the hostname at your server and let it propagate before you start the stack — Caddy asks
for a certificate on its first boot, and a request that fails because DNS is not live yet
counts against Let's Encrypt's rate limit.

```
kurul.example.com.   A     203.0.113.10
kurul.example.com.   AAAA  2001:db8::10      # only if the server has IPv6
```

Check it from somewhere that is not the server itself:

```bash
dig +short kurul.example.com
```

## 2. Fetch the compose file and configure

```bash
mkdir -p /opt/kurul && cd /opt/kurul
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurul/main/docker-compose.yml
curl -fsSL --create-dirs -o docker/Caddyfile \
  https://raw.githubusercontent.com/dravcore/kurul/main/docker/Caddyfile
curl -fsSL --create-dirs -o scripts/backup.sh \
  https://raw.githubusercontent.com/dravcore/kurul/main/scripts/backup.sh
chmod +x scripts/backup.sh
curl -fsSL -o .env https://raw.githubusercontent.com/dravcore/kurul/main/.env.example
```

`scripts/backup.sh` is not optional: the `backup` service in `docker-compose.yml` bind-mounts
that exact path into its container, and without the file the scheduled backups that service
exists to take never run.

Edit `.env`. For a Docker-only install these are the lines that matter — everything else in the
file is either for the development loop or has a working default:

```bash
SITE_URL=https://kurul.example.com          # your domain, scheme included

POSTGRES_PASSWORD=<openssl rand -hex 32>       # hex, not base64 — it goes inside a URL
BETTER_AUTH_SECRET=<openssl rand -hex 32>      # session signing key

SMTP_HOST=smtp.example.com                     # see "Email" below
SMTP_PORT=587
SMTP_USER=kurul@example.com
SMTP_PASSWORD=<your smtp password>
SMTP_SECURE=false                              # true only for port 465
MAIL_FROM=Kurul <kurul@example.com>
```

Generate both secrets with `openssl rand -hex 32`. `POSTGRES_PASSWORD` is embedded directly in
a connection URL, where a `/` from `-base64` output would truncate it — `-hex`'s alphabet
(`0-9a-f`) has none. `BETTER_AUTH_SECRET` is only ever byte-compared, so it carries no such
constraint, but generating it with `-hex` too means one generator to remember instead of a
per-variable rule.

`SITE_URL` carries the scheme because that is what decides whether Caddy serves plain HTTP or
obtains a certificate. `https://…` switches automatic HTTPS on. `http://localhost` (the
default) is the local, no-domain install.

**Attachments need no line here.** `docker-compose.yml` sets `STORAGE_PATH` itself, to a
directory inside the `attachment_data` volume, so a Compose install accepts file uploads out of
the box — the `.env` copy of that variable is for the development loop only. The one value you
may want to change is `ATTACHMENT_MAX_BYTES` (default `26214400`, 25 MiB), and if you do, read
[the proxy contract below](#bringing-your-own-reverse-proxy) first: the reverse proxy carries a
separate, deliberately higher ceiling that has to move with it.

**Attachment storage is capped by default, and it shares Postgres's disk.** The
`attachment_data` volume lives on the same host filesystem as the database, so a full disk
stops Postgres, not just uploads. Two variables cap the total
([ADR 0027](decisions/0027-attachment-quotas.md), updated 2026-08-21):
`ATTACHMENT_WORKSPACE_QUOTA_BYTES` (summed stored-file bytes per workspace) and
`ATTACHMENT_INSTANCE_QUOTA_BYTES` (the whole instance). Unset, they are **2 GiB per workspace
(`2147483648`) and 20 GiB per instance (`21474836480`)**; a written `0` lifts one entirely, and
a negative value refuses to boot. Set the instance one below your volume's real headroom on
any machine whose disk you care about. The API logs the effective numbers at start
(`Attachment ceilings: … (default)` / `(env)` in `docker compose logs api`), and warns, rather
than refusing, if the workspace quota is set above the instance quota. When sizing, know that
the quotas are **soft** (simultaneous uploads can each overshoot by at most one file, so leave
a few `ATTACHMENT_MAX_BYTES` of slack) and that deleted files keep their bytes until the
nightly orphan sweep's grace period passes, so disk usage briefly exceeds what the quota
accounts for. Link attachments store no bytes and never count. A rejected upload is a `413`
whose JSON body carries `error: "Attachment Quota Exceeded"`, see
[Telling the 413s apart](#telling-the-413s-apart).

**Uploads are also budgeted in bytes per minute.** `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`
(default `268435456`, 256 MiB, about ten max-size uploads) is the most one client IP may submit
to the upload route in a fixed minute, charged from each request's `Content-Length` before the
body is read (a multipart request without one is charged `ATTACHMENT_MAX_BYTES`). It exists
because the per-route request throttle counts requests, which is the wrong unit for disk. `0`
switches it off. It is keyed by the same client IP as every other limit, so it needs the
`TRUST_PROXY` setting the bundled Compose file already carries to see through the proxy; the
counters live in Redis and fall back to process memory while Redis is erroring. Over budget is
a `429` whose JSON body carries `error: "Upload Budget Exceeded"` and a `Retry-After` header
([api-conventions.md](api-conventions.md#rate-limiting)).

**Trello import needs no line here either.** `TRELLO_IMPORT_MAX_BYTES` (default `20971520`,
20 MiB) is the largest board export the importer will accept, and the bundled Compose file
already passes it. Three things about it are worth knowing before you touch it. It is a
**memory** ceiling, not a disk one: the upload is buffered and then `JSON.parse`d, and the parsed
object graph is a multiple of the bytes that produced it — so raising this raises the API's peak
heap by a multiple of the difference, not by the difference. It is **unrelated to
`ATTACHMENT_MAX_BYTES`**, which is why it is a second variable rather than a reuse of the first.
And it must stay **below the proxy's body limit** (26 MiB in the bundled `docker/Caddyfile`) with
room for the multipart envelope, for exactly the reason the attachment limit does — see
[the proxy contract below](#bringing-your-own-reverse-proxy). Importing works on an instance with
no `STORAGE_PATH` at all: an import creates link attachments, which store no bytes.

## 3. Start it

```bash
docker compose pull
docker compose up -d
docker compose ps -a     # see below for what "right" looks like
```

`ps -a`, not a plain `ps`: `migrate` is a one-shot job that has already exited by the time you
look, and a plain `ps` lists running containers only, so it omits the row you most want to
check. A healthy stack reads like this:

```
api        Up 27 seconds (healthy)
backup     Up 28 seconds (health: starting)
migrate    Exited (0) 27 seconds ago
postgres   Up 34 seconds (healthy)
proxy      Up 16 seconds
redis      Up 34 seconds (healthy)
web        Up 22 seconds (healthy)
```

`Exited (0)` on `migrate` is success — migrations applied, job done. A non-zero exit there is
the one to chase (`docker compose logs migrate`), and `api` will not have started at all.
`proxy` shows no `(healthy)` at all because it declares no healthcheck. `backup` does declare
one — it watches for a fresh dump in `/backups` — but its `start_period` is generous (10
minutes) so a database still taking its first `pg_dump` reads as `(health: starting)`, not
unhealthy; give it time and check again with `docker compose ps backup`.

The first request to `https://kurul.example.com` may take a few seconds while Caddy
completes the ACME challenge. Watch it happen if it does not:

```bash
docker compose logs -f proxy
```

Open the site, create the first account, and create a workspace. The first account is a normal
account — Kurul has no separate installer or admin bootstrap step.

## 4. Check it actually works

```bash
curl -sI https://kurul.example.com | head -1          # 307 → /login
curl -s  https://kurul.example.com/api/health/ready   # {"status":"ok", …}
```

Then, in the browser, open a board and drag a card. If the card moves for a second browser
window without a refresh, the realtime WebSocket is connected through the proxy — which is the
one part of the stack a naive reverse-proxy configuration tends to break silently.

Last, check the thing HTTPS was actually for. Sign in and look at the cookie you get back:

```bash
curl -si https://kurul.example.com/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"<your password>"}' | grep -i '^set-cookie'
```

You want to see the name prefixed and the attribute present:

```
set-cookie: __Secure-better-auth.session_token=…; Path=/; HttpOnly; Secure; SameSite=Lax
```

`Secure` means the browser will refuse to send that token over plain HTTP, and `__Secure-`
means it will refuse to _accept_ the cookie at all unless the connection was HTTPS. Neither is
a setting you turn on: Better Auth derives both from the scheme of the URL it is configured
with, which `docker-compose.yml` takes from `SITE_URL`. That makes the scheme in `SITE_URL` the
single switch that decides whether session tokens are protected in transit — with
`SITE_URL=http://…` the same request answers `set-cookie: better-auth.session_token=…;
HttpOnly; SameSite=Lax`, no prefix and no `Secure`, and the session token crosses the network in
clear text on every request. If you see the unprefixed form on a domain you believe is HTTPS,
`SITE_URL` still has `http://` in it; fix it and `docker compose up -d`.

## 5. Point a monitor at it

This is a step of the deployment, not an optional extra, and it is the last one because it is
the first one that needs a running instance to watch. `restart: unless-stopped` brings a crashed
container back; nothing in this stack tells you when the host is down, the disk filled, or
Postgres stopped accepting connections. An external monitor is the only signal that survives the
machine it is watching.

Monitor this URL:

```
https://kurul.example.com/api/health/ready
```

Two details in that URL are easy to get wrong, and both fail quietly.

**The `/api` prefix is required.** `/health/ready` without it is not the API — it matches the
proxy's catch-all rule and lands on the web app, which answers `307` and redirects to `/login`.
A monitor configured that way is red forever on a healthy instance, and if you widen its
accepted status codes to stop the noise it becomes green forever instead, including during an
outage.

**`/health/ready`, not `/health`.** `/health` is a liveness probe: it answers `200` as long as
Node is alive, deliberately including while the database is unreachable, because restarting the
process cannot heal a database. `/health/ready` is the one that goes red when the product is
actually broken, and its body names the dependency that failed:

```json
{ "status": "error", "checks": { "database": "down", "redis": "up" } }
```

The full parameter list — 5-minute interval, 2 consecutive failures before alerting, accept only
`200`, 10-second timeout, e-mail contact with the "back up" notification enabled — is in
[Uptime monitoring](development.md#uptime-monitoring--set-this-up-it-is-the-one-that-catches-an-outage),
along with the push-based alternative for an instance that is not reachable from the internet.

**Also watch backup freshness — `/api/health/ready` does not cover it.** The `backup` sidecar
can stop producing dumps (a `pg_dump` that keeps failing, a volume that filled up) without ever
touching the database connection the API's readiness probe checks, so that endpoint stays green
through the whole outage. `backup`'s own Docker healthcheck is the signal instead: unhealthy
means the newest `/backups/kurul-*.dump` is older than `2 × BACKUP_INTERVAL` (48 hours on the
default 24h interval), which is the point at which the API's own retention sweep can no longer
assume a recent dump exists to fall back on. Point your monitor's container-health check (most
uptime tools that support Docker, or a cron `docker inspect` on the host) at it, or at minimum
check it by hand periodically:

```bash
docker compose ps backup                                        # "(healthy)" or "(unhealthy)"
docker inspect --format '{{.State.Health.Status}}' kurul-backup-1
```

An `(unhealthy)` `backup` does not need a restart — `restart: unless-stopped` does not act on
health status, so the sidecar keeps running and retrying on its own — it needs
`docker compose logs backup` read, because something (usually a failing `pg_dump`) is actually
wrong and the next scheduled cycle inherits the same problem until that's fixed.

Then fire it once on purpose, because an alerting setup that has never fired is a hypothesis:

```bash
docker compose stop postgres
curl -s https://kurul.example.com/api/health/ready   # 503, "database":"down"
# wait two intervals, expect the red alert
docker compose start postgres
curl -s https://kurul.example.com/api/health/ready   # 200, "database":"up"
# expect the recovery mail
```

`/health/ready` returning `503` while `/health` stays `200` during that window is the correct
behaviour, not a bug — it is the difference the two endpoints exist to express.

## Email (SMTP)

Invitations are the one feature that hard-fails without SMTP: accepting an invitation requires
a verified email address, and verification needs a delivered message
([ADR 0013](decisions/0013-invitation-email-verification.md)). With `SMTP_HOST` unset the API
still boots and logs the message instead of sending it, so a solo install works fine — but
nobody can join your workspace. The Members screen says so in the product, too. Notification
email (assignment, mention, due-soon) uses the same settings and simply stays off without
them; once SMTP works, each user can switch it off for themselves under Settings.

Any SMTP provider works. Two things go wrong most often:

- **`SMTP_SECURE`.** `true` means implicit TLS, which is port 465 only. Port 587 and 25 use
  STARTTLS and need `false`. Setting `true` on 587 hangs the connection.
- **`MAIL_FROM` must be an address the provider lets you send as.** Most providers reject a
  `From:` that does not match the authenticated account or a verified domain, and the rejection
  looks like "invitations do nothing" rather than an error in the UI.

Send yourself an invitation as the test. If nothing arrives:

```bash
docker compose logs api | grep -i mail
```

## Backups

The `backup` service is already running: every `BACKUP_INTERVAL` seconds (24h by default) it
writes **two** archives into the `backup_data` volume — a `pg_dump` of the database and a
`.tar.gz` of the uploaded attachment files — and keeps `BACKUP_KEEP` of each series. Both
archives of one cycle carry the **same timestamp**, which is how a restore knows which tar
belongs to which dump.

That covers "I deleted the wrong workspace". It does not cover a dead disk — the archives sit
on the same host as the database. Copy them off the machine, **both halves of the newest
cycle**, not just the dump:

```bash
docker run --rm -v kurul_backup_data:/backups -v "$PWD:/out" alpine \
  sh -c 'stamp=$(ls -t /backups/*.dump | head -1 | sed "s|.*/kurul-||;s|\.dump$||"); \
         cp /backups/kurul-$stamp.dump /out/; \
         cp /backups/kurul-$stamp-files.tar.gz /out/ 2>/dev/null || true'
```

A dump restored without its file archive brings every row back and leaves every uploaded file
behind — and passes every verification step that was written before attachments existed. The
drill in [Restoring from a backup](development.md#restoring-from-a-backup) checks the files too.

Restore steps are in [Upgrading and backups](development.md#upgrading-and-backups).

## Upgrading

```bash
docker compose pull && docker compose up -d
```

Migrations run automatically: the one-shot `migrate` service applies them before `api` starts.
Pin a release with `TAG=v0.2.0` in `.env` if you would rather upgrade deliberately than track
`latest`.

### Attachment quotas now have defaults

Releases after `v0.2.0` cap attachment storage at 2 GiB per workspace and 20 GiB per instance
when `ATTACHMENT_WORKSPACE_QUOTA_BYTES` / `ATTACHMENT_INSTANCE_QUOTA_BYTES` are unset (they
used to mean unlimited). **A workspace already holding more than 2 GiB of files will get a
`413` on its next upload** unless you set a higher number, or `0` for unlimited, before you
upgrade. One query says where you stand; the first line is the instance, the second is per
workspace:

```bash
docker compose exec postgres psql -U kurul -d kurul -c \
  "SELECT COALESCE(SUM(size), 0) AS instance_bytes FROM \"Attachment\" WHERE kind = 'FILE';"
docker compose exec postgres psql -U kurul -d kurul -c \
  "SELECT w.slug, SUM(a.size) AS bytes FROM \"Attachment\" a JOIN \"Task\" t ON t.id = a.\"taskId\" JOIN \"Board\" b ON b.id = t.\"boardId\" JOIN \"Workspace\" w ON w.id = b.\"workspaceId\" WHERE a.kind = 'FILE' GROUP BY w.slug ORDER BY bytes DESC;"
```

Compare the numbers against `2147483648` and `21474836480`. The same upgrade adds a per-IP
upload byte budget (`ATTACHMENT_UPLOAD_BYTES_PER_MINUTE`, 256 MiB a minute by default), which
only matters to a client that uploads more than ten max-size files a minute from one address.

### Coming from Kurultay (v0.1.0)

The project was renamed before v0.2.0, and the rename reaches further than the label on the
README: the Postgres role and database are now `kurul`, the published images are
`ghcr.io/dravcore/kurul-api` and `-web`, and Compose derives its volume prefix from the install
directory, which the instructions above now call `/opt/kurul`. An existing v0.1.0 install does
not pick any of that up on its own, and `docker compose pull` against the old image names will
simply keep serving you the old ones.

**There is no in-place upgrade path that renames a running database for you.** Do it in this
order, with the stack down, and take the backup first — this is the one upgrade in this
project's history that touches identifiers rather than schema.

```bash
cd /opt/kurultay
docker compose exec postgres pg_dump -U kurultay -Fc kurultay > /tmp/kurul-migration.dump
docker compose down                     # NOT -v: the volumes are what you are keeping
```

Then rename the directory and take the new compose file:

```bash
cd /opt && mv kurultay kurul && cd kurul
curl -fsSLO https://raw.githubusercontent.com/dravcore/kurul/main/docker-compose.yml
```

Edit `.env`: `POSTGRES_USER` and `POSTGRES_DB` become `kurul`, and the `DATABASE_URL`
credentials and database segment change with them. Then create the new role and database
against the volume you kept, and restore into it:

```bash
docker compose up -d postgres
docker compose exec -T postgres psql -U kurultay -d kurultay   -c "CREATE ROLE kurul LOGIN PASSWORD '<your POSTGRES_PASSWORD>';"   -c 'CREATE DATABASE kurul OWNER kurul;'
docker compose exec -T postgres pg_restore -U kurul -d kurul --no-owner < /tmp/kurul-migration.dump
docker compose up -d
curl -s https://your.domain/api/health/ready
```

The old role and database can be dropped once the new stack has served real traffic for a day.
Keep the dump until then; it is the only copy that predates the rename.

**Renaming the directory is what moves the volumes**, because Compose namespaces them by
project name — `kurultay_postgres_data` becomes `kurul_postgres_data`. If you would rather not
move them, set `COMPOSE_PROJECT_NAME=kurultay` in `.env` and the old volumes keep being used
under their old names. That is supported and slightly confusing; either is fine, as long as you
pick one deliberately.

## Verifying what you pulled

`docker compose pull` trusts whatever ghcr.io hands it. Two things published with every release
let you stop doing that: a **signature** that says this image came out of this repository's
release workflow, and an **SBOM** that says what is inside it. Both are optional to use and
neither protects anyone who never runs the commands below.

### Checking the signature

You need [cosign](https://github.com/sigstore/cosign) **3.0 or newer** — the signatures are
written in the Sigstore bundle format that cosign 3 uses by default, and cosign 2 cannot read
them.

```bash
cosign verify \
  --certificate-identity "https://github.com/dravcore/kurul/.github/workflows/release-images.yml@refs/tags/v0.2.0" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  ghcr.io/dravcore/kurul-api:v0.2.0
```

Repeat it for `kurul-web` — and, on releases after v0.2.0, for `kurul-migrate`, which is
signed the same way from the release that first publishes it — and replace `v0.2.0` in both
places when you verify another release. The version appears twice for two different reasons:
once as the git ref the signing workflow ran on, and once as the image tag you are asking
about.

**The two `--certificate-*` flags are the entire check; do not drop them.** There is no signing
key to guard here. The images are signed keylessly: the release workflow trades a GitHub OIDC
token for a certificate valid for a few minutes, signs, and the certificate expires. What makes
the result meaningful is not that a secret was kept, it is that the certificate records _which
workflow, in which repository, at which git ref_ asked for it. Without `--certificate-identity`
cosign will happily accept a validly-signed image from anybody at all — including someone who
pushed a tag to their own fork of this repository.

A successful run prints the checks it performed and a JSON claim naming the digest it verified:

```
Verification for ghcr.io/dravcore/kurul-api:v0.2.0 --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - Existence of the claims in the transparency log was verified offline
  - The code-signing certificate was verified using trusted certificate authority certificates
```

Anything else is a failure, and the two failures worth telling apart are `no signatures found`
(this image was never signed — it predates this feature, or it is not the image you think it is)
and `no matching CertificateIdentity found` (it _was_ signed, by someone or something other than
the identity you asked for; the error prints the identity it actually found).

Verification reaches out to Sigstore's public infrastructure for the trust root and the
transparency log, so it wants outbound HTTPS. Run it from your laptop before you deploy if the
server has none.

Both the tag and the digest work as the last argument, and on a host that has already pulled,
the digest is the stricter question — it asks about the exact bytes on disk rather than about
whatever the tag points at now:

```bash
docker image inspect ghcr.io/dravcore/kurul-api:v0.2.0 --format '{{index .RepoDigests 0}}'
```

### Where the SBOM lives

On the [GitHub Release](https://github.com/dravcore/kurul/releases) for the version, as
downloadable assets — one per image per architecture, because the two architectures genuinely
do not contain the same packages:

```
kurul-api-v0.2.0-linux-amd64.spdx.json
kurul-api-v0.2.0-linux-arm64.spdx.json
kurul-web-v0.2.0-linux-amd64.spdx.json
kurul-web-v0.2.0-linux-arm64.spdx.json
```

Releases after v0.2.0 add the same pair for `kurul-migrate`.

The format is SPDX 2.3 JSON, which is what `grype`, `trivy` and Dependency-Track all read
without conversion:

```bash
gh release download v0.2.0 --repo dravcore/kurul --pattern '*.spdx.json'
grype sbom:./kurul-api-v0.2.0-linux-amd64.spdx.json
```

**The SBOM file itself is not signed** — the signature above covers the image, and the SBOM is a
description of it produced by the same workflow run. For most people that is enough, because a
tampered SBOM cannot make a tampered image verify. If you need the stronger property, do not
trust the file: regenerate it yourself from the image you have already verified, with
[syft](https://github.com/anchore/syft), and compare.

```bash
syft scan registry:ghcr.io/dravcore/kurul-api:v0.2.0 --platform linux/amd64 -o spdx-json
```

## Bringing your own reverse proxy

If you already run nginx, Traefik or another proxy and would rather not stack a second one,
you can replace the `proxy` service — but the routing contract is not negotiable, because the
web app is built against it. Three rules, in this order, all on one hostname:

| Path       | Goes to  | Prefix              | Max request body              |
| ---------- | -------- | ------------------- | ----------------------------- |
| `/auth/*`  | api:4000 | kept as-is          | proxy default is fine         |
| `/api/*`   | api:4000 | `/api` **stripped** | **26 MiB** (`27262976` bytes) |
| everything | web:3000 | kept as-is          | proxy default is fine         |

`/api/*` must also pass WebSocket upgrades through — that is the realtime board feed.

#### Why the proxy's number is 26 MiB and the API's is 25

**This is not a typo and the two must not be made equal.** The largest _attachment_ this
instance accepts is `ATTACHMENT_MAX_BYTES`, 25 MiB — that is the number to quote to users and
the only one to change when you want a different limit. The proxy's 26 MiB is a ceiling above
it, not a second copy of it.

They differ because they count different things. `client_max_body_size` (and Caddy's
`request_body max_size`) counts the **whole request body**; `ATTACHMENT_MAX_BYTES` counts the
**file** inside it. An upload wraps the file in a multipart envelope — a boundary line and a
`Content-Disposition` header per part, plus the closing boundary — which adds to the body on top
of the file's own bytes. Measured against the real request this API receives, that envelope is
309 bytes for a short filename and 563 bytes for a 255-character one.

So a proxy set to exactly 25 MiB rejects a 25 MiB attachment: the file is within the documented
limit, the body is not. The user gets a `413` on a file the documentation says is allowed, and
the number they are pointed at is the one that is not the problem.

The rule the two layers actually follow is an ordering, not an equality:

> **The proxy must never reject something the API would accept.** The proxy's job is to cut
> absurd bodies before anything buffers them. The exact file limit belongs to the API — the only
> layer that can answer with _which_ file was too big.

**A second body crosses the same proxy: the Trello import.** `TRELLO_IMPORT_MAX_BYTES` (20 MiB)
sits under the same ordering rule and under the same 26 MiB proxy ceiling, with more headroom
because it is a smaller number. The relationship checked between the two is an **inequality**, not
the equality-plus-envelope the attachment limit is held to — the import limit only has to stay
below the proxy's, not track it — so raising `TRELLO_IMPORT_MAX_BYTES` past the proxy's number
gives you an import the proxy kills with an empty-bodied `413` the API never sees.
`apps/api/src/storage/two-layer-limit.spec.ts` fails the build if either relationship stops
holding.

So: raise `ATTACHMENT_MAX_BYTES` and you must raise the proxy's number to stay above it (1 MiB
of headroom is what the bundled config ships and is ~1860x the largest envelope measured).
Lower the proxy's below the API's and every upload near the limit fails with a `413` the API
never sees and never logs. Caddy imposes no body limit of its own, which is why the bundled
`docker/Caddyfile` has to set one explicitly — and nginx defaults `client_max_body_size` to
**1 MB**, so a replacement proxy that omits the row rejects every attachment larger than a
megabyte.

### Telling the 413s apart

Both layers answer an oversized upload with `413` — and so does a third limit that has nothing
to do with uploads. **The response body is what says which one did it**:

| What you get back                                  | Who rejected it | What it means                                                    |
| -------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| `413` with a **JSON** body carrying `statusCode`   | the API         | working as designed — the file is over `ATTACHMENT_MAX_BYTES`    |
| `413` with an **empty** body (`Content-Length: 0`) | the proxy       | the body was over the proxy's ceiling, which is the coarse cut   |
| `413` JSON reading `Request body is too large`     | the API         | not an upload at all — a JSON body over `REQUEST_BODY_MAX_BYTES` |
| `413` JSON, `error: "Attachment Quota Exceeded"`   | the API         | the file fits, the storage doesn't — a quota is full (see above) |

The first row is the normal answer for an oversized attachment, and the one a user can act on:
it names the limit. The second is the proxy refusing a body before the API ever saw it — correct
for something absurd, but if a user hits it on a file **under** `ATTACHMENT_MAX_BYTES` then your
proxy's ceiling is too low (see "Why the proxy's number is 26 MiB and the API's is 25" above).

The third row is a different limit that happens to share the status code: `REQUEST_BODY_MAX_BYTES`
(default `1048576`, 1 MiB) caps the **JSON and form-encoded** bodies every other endpoint takes,
and no attachment ever passes through it. If you see it, nothing about your storage or your proxy
is misconfigured — some request simply sent more JSON than the API accepts.

The fourth row is a different failure again: the file is under `ATTACHMENT_MAX_BYTES`, but storing
it would push a workspace or the instance over its quota. See "Attachment storage is unbounded
until you cap it, and it shares Postgres's disk" above for sizing `ATTACHMENT_WORKSPACE_QUOTA_BYTES`
and `ATTACHMENT_INSTANCE_QUOTA_BYTES`.

There is a fifth, and only one endpoint can produce it: a `413` on
`POST /workspaces/…/imports/trello` is `TRELLO_IMPORT_MAX_BYTES` (20 MiB), not any of the four
above. The route in the response envelope's `path` is what tells it apart. If a user hits it on an
export **under** 20 MiB, the proxy cut the body first and the ceiling to look at is the proxy's.

The headers do not help — Caddy's `413` carries no `Server` header, so only the body
distinguishes them. Everything the API itself rejects comes back as
`Content-Type: application/json; charset=utf-8` with a `{"statusCode":…,"error":…,"path":…,
"requestId":…}` envelope; the proxy's rejection carries no body at all.

**The proxy does not log this rejection.** `docker/Caddyfile` has no `log` directive — the API
already logs every request that reaches it, and access logs on both layers would double every
deployment's log volume for one size check — so a body rejected by the proxy appears in
`docker compose logs proxy` **not at all**. An empty `413` with nothing in the proxy log is the
expected result, not evidence that the limit is broken.

Measured on `docker/Caddyfile` against `caddy:2-alpine`, with the limit it carried at the time
(`25MiB`): exactly `26214400` bytes of body → `200`, one byte more → `413`, with `curl` exiting
`0` on a well-formed status line — the connection is closed properly rather than cut mid-upload.
That is what established the threshold is `> max_size` rather than `>=`, and it is also what
showed the limit had to move: a 26214400-byte _file_ produces a body a few hundred bytes larger
than that, so the shipped config now sets `26MiB` and the same measurement's boundary moves with
it.

If you reproduce this yourself, **aim it at a real upload endpoint**. Pointing it at an
arbitrary path measures nothing: the API answers `404` as soon as it has the headers, without
ever reading the body, so the request finishes before the proxy's limit is reached and you get a
`404` that looks like the limit is missing.

The two API rules differ on purpose. Better Auth derives its mount path from the URL it is
configured with and matches incoming requests against it, so `/auth` has to be the same string
on the server, in the browser and in the verification links it emails; the rest of the API is
mounted at its own root and gets the prefix removed on the way in. In nginx:

```nginx
location /auth/ { proxy_pass http://api:4000;  }   # no trailing slash → path preserved
location /api/  {
  proxy_pass http://api:4000/;                     # trailing slash    → /api stripped
  client_max_body_size 26m;                        # ABOVE ATTACHMENT_MAX_BYTES (25 MiB), not
                                                   # equal to it — the multipart envelope rides
                                                   # on top of the file. See the section above.
}
location /      { proxy_pass http://web:3000;  }
```

If your proxy sits in front of Kurul's own `proxy` rather than replacing it, raise
`TRUST_PROXY` in `docker-compose.yml`'s `api` service to the number of hops (a CDN in front of
Caddy makes it `2`). Left at `1`, every rate-limit bucket and every access-log IP collapses
onto your outer proxy's address.

## Why there is no rebuild

Next.js compiles `NEXT_PUBLIC_*` variables into the JavaScript it ships, at build time. An
absolute `NEXT_PUBLIC_API_URL` therefore makes a web image specific to one deployment, and
"pull the image, set the environment" cannot work — which is exactly what Kurul used to
require ([audit finding PM-02](https://github.com/dravcore/kurul/issues/119)).

The fix is not to un-bake the value but to bake a value that is already correct everywhere. The
published image carries `NEXT_PUBLIC_API_URL=/api`, a path on whatever origin the page was
served from, so it is right on `kurul.example.com` and on `boards.acme.internal` alike. That
only holds because the reverse proxy puts both apps on one origin, which is why `proxy` is part
of the default stack rather than an optional extra.

Server-side rendering cannot use a path — there is no origin to resolve it against inside
Node — so it reads `INTERNAL_API_URL` instead, which is an ordinary runtime variable
docker-compose.yml points straight at `http://api:4000` over the container network.

A deployment that genuinely wants the API on its own hostname can still build the web image
with an absolute URL:

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
```

That image is then specific to `api.example.com`, and you are back to rebuilding per
deployment — which is the trade-off, not an oversight.

## Troubleshooting

**`docker compose pull` ends in `denied`.** The images are published by a workflow that runs
on a release tag, so each exists only from the release that first shipped it: `api` and `web`
from `v0.2.0`, `kurul-migrate` from the first release after `v0.2.0` — on `v0.2.0` the pull
fails for that one image even though the other two resolve. Two things follow while you are on
a release that predates an image. `docker compose pull` exits non-zero after successfully
pulling `postgres`, `redis` and `caddy` — read the tail of its output, not just the exit code,
because the ones that worked scroll the ones that did not off the screen. And the files you
fetch in step 2 come from the `main` branch, which only carries what the newest release
carried: if `docker-compose.yml` has no `proxy:` service and there is no `docker/Caddyfile` to
download, you are ahead of the release, and none of the HTTPS in this guide applies to what
you just downloaded. Either wait for the release, or build from source instead of pulling:

```bash
git clone https://github.com/dravcore/kurul.git && cd kurul
docker compose up -d --build
```

That is slower — the api image is a minute or so of build — and it is the only difference.
`docker-compose.yml` carries `image:` and `build:` for all three services on purpose, so the
same file installs from a published image when one is resolvable and from source when it is
not.

**Certificate never issues.** Ports 80 and 443 must both reach the server from the public
internet, and DNS must already resolve. `docker compose logs proxy` names the failure. Hitting
Let's Encrypt's rate limit (5 certificates per domain per week) means waiting it out — the
`caddy_data` volume exists to make sure a restart never re-requests one it already has.

**Boards load but never update by themselves.** The WebSocket is not getting through. With the
bundled `proxy` this should not happen; with your own, check that your `/api/*` rule forwards
`Upgrade`/`Connection` headers.

**Sign-in fails right after changing the domain.** `SITE_URL` is the origin the session cookie
is scoped to. Change it, run `docker compose up -d` (which recreates `api` with the new value),
and sign in again — the old cookie belongs to the old origin.

**Everything 502s.** `docker compose ps`. If `api` is unhealthy, `docker compose logs api`; the
usual cause is a `POSTGRES_PASSWORD` in `.env` that no longer matches the one baked into an
existing `postgres_data` volume — see
[Database and cache credentials](development.md#database-and-cache-credentials).
