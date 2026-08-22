import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { organization } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';
import { PrismaClient } from '../generated/prisma';
import { loadRootEnv, envString } from '../common/env';
import { RESOLVED_CLIENT_IP_HEADER } from '../common/trust-proxy';
import { buildVerificationEmail } from '../mail/mail-templates';
import { acceptLanguageOf, resolveRecipientLocale } from '../mail/recipient-locale';
import { sendMail } from '../mail/send-mail';
import { readStoredLocale } from '../mail/stored-locale';
import { createSharedPrismaAdapter, registerPoolConsumer } from '../prisma/database';
import { authRateLimitOptions } from './auth-rate-limit';
import { organizationOptions } from './organization-options';
import { resolveVerificationUrl, webAppUrl } from './web-urls';

loadRootEnv();

const authSecret = process.env.BETTER_AUTH_SECRET?.trim();
if (!authSecret) {
  throw new Error('BETTER_AUTH_SECRET is required');
}

const prisma = new PrismaClient({ adapter: createSharedPrismaAdapter() });

// Better Auth's client borrows from the same pg pool as PrismaService. Hand its disconnect to
// the pool's owner (`prisma/database.ts`) instead of tearing it down from AuthModule: Nest
// does not order `onModuleDestroy` hooks, so a self-managed disconnect could land after the
// pool had already been ended. `closeSharedDatabase` now drains this client first, always.
registerPoolConsumer(() => prisma.$disconnect());

const betterAuthUrl = envString('BETTER_AUTH_URL', 'http://localhost:4000');
const webUrl = webAppUrl();

// How long `session.cookieCache` answers `auth.api.getSession` from a signed cookie without a
// database read (SEC-01). That skipped read is also the entire reason server-side revocation —
// password change, admin force-delete, `Session` rows cleared to recover a stolen cookie — can
// keep looking "live" after it happened: the browser's cookie is still validly signed. At
// self-host scale one DB read per user per minute is noise, so the cache buys little by running
// longer than that; pinned to 60s rather than dropped outright, since a per-request DB round
// trip is still not free at the top of the request path. Not exposed as an env knob — nobody has
// asked to tune it, and the trigger for adding one is a deployment where the per-minute read
// itself measurably hurts, not a guess that one might exist.
const SESSION_COOKIE_CACHE_MAX_AGE_SECONDS = 60;

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: authSecret,
  baseURL: betterAuthUrl,
  basePath: '/auth',
  trustedOrigins: [webUrl],
  // `/auth/*` is served by raw Express, below the Nest router, so the global ThrottlerGuard
  // does not cover it — see `auth-rate-limit.ts` for what this configures and why.
  rateLimit: authRateLimitOptions(),
  session: {
    // Avoids a database round trip on every authenticated request; the signed cookie
    // is re-validated against the DB once it expires. See the comment on
    // `SESSION_COOKIE_CACHE_MAX_AGE_SECONDS` above for why that expiry is 60s, not longer.
    cookieCache: {
      enabled: true,
      maxAge: SESSION_COOKIE_CACHE_MAX_AGE_SECONDS,
    },
  },
  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
    // Left off, and that is now a deployment decision rather than a local-dev convenience.
    //
    // A published Kurul serves the web app and this API from one hostname
    // (`docker/Caddyfile`), so the session cookie is same-site with the page that reads it and
    // Better Auth's defaults apply: both `session_token` and `session_data` go out
    // `HttpOnly; SameSite=Lax` (measured, not assumed). Turning this on would widen the cookie
    // to `Domain=.example.com`, which makes every sibling subdomain same-site with the API —
    // `Lax` would keep sending the session for requests one of them initiates, and an operator
    // does not control all of them. A split-domain deployment (api on its own registrable
    // domain) is worse still: it needs `SameSite=None`, which removes the `SameSite` defence
    // outright.
    //
    // Neither shape is unsupported — `WEB_URL`, `BETTER_AUTH_URL` and `NEXT_PUBLIC_API_URL` are
    // independent settings and the dev loop itself runs two ports — so the API no longer relies
    // on the cookie attribute alone: `common/origin-check.ts` refuses state-changing requests
    // that announce an origin outside the allowlist, on both routers, whatever `SameSite` says.
    crossSubDomainCookies: {
      enabled: false,
    },
    // Better Auth's rate limiter (`authRateLimitOptions` above) keys its counters by client
    // IP, resolved by re-parsing headers itself — it never consults Express's `trust proxy`
    // setting. Left at Better Auth's default (`x-forwarded-for`), that resolution accepts a
    // single-value header outright even with no `trustedProxies` configured, so a directly
    // exposed instance — no reverse proxy in front of it at all — is still spoofable through
    // `/auth/*`: any client can send `X-Forwarded-For: 1.2.3.4`, rotate the value per request,
    // and walk straight past the per-IP sign-in limit.
    //
    // Pointing this at `RESOLVED_CLIENT_IP_HEADER` instead closes that: `configureTrustProxy`
    // (`common/trust-proxy.ts`) stamps that header, on every request, with Express's own
    // `req.ip` — the same trust-proxy-aware resolution the Nest `ThrottlerGuard` and the
    // access log use — and a client cannot influence it because the middleware overwrites
    // whatever value it finds. No separate `trustedProxies` list is configured here: it would
    // duplicate `TRUST_PROXY`'s hop-count/CIDR parsing in a second library's format for no
    // benefit, since by the time Better Auth sees this header the trust decision has already
    // been made once, by Express, for both routers.
    ipAddress: {
      ipAddressHeaders: [RESOLVED_CLIENT_IP_HEADER],
    },
  },
  user: {
    modelName: 'user',
    fields: {
      image: 'avatarUrl',
    },
  },
  emailAndPassword: {
    enabled: true,
    // Product decision: an unverified address can sign up and sign in normally. Verification
    // gates exactly one thing — accepting a workspace invitation, see `organization-options.ts`
    // — so existing accounts are never locked out by this feature landing.
    requireEmailVerification: false,
  },
  emailVerification: {
    // `sendOnSignUp` defaults to following `requireEmailVerification`, which is `false` above
    // and would mean "never offer anyone a verification link". Every new account gets one:
    // verification is optional for signing in but mandatory before joining a workspace, so a
    // user must always have a way to reach the verified state.
    sendOnSignUp: true,
    // The session cookie caches the user for 60 seconds (`session.cookieCache`), so a user who
    // has just verified would keep presenting `emailVerified: false` — and keep being refused
    // by accept-invitation — until that cache expired. Better Auth rewrites the session cookie
    // here, which fixes the staleness, and signs the user in when they opened the link in a
    // browser that had no session.
    autoSignInAfterVerification: true,
    // Recipient and actor are the same person here, and on sign-up that person has had no
    // opportunity to store a language yet — so in practice this resolves from the
    // `Accept-Language` of the browser they signed up in, and from `User.locale` only on a
    // resend after they picked one.
    async sendVerificationEmail({ user, url }, request) {
      const locale = await resolveRecipientLocale(readStoredLocale, {
        to: user.email,
        acceptLanguage: acceptLanguageOf(request),
      });

      await sendMail(
        buildVerificationEmail({
          to: user.email,
          name: user.name,
          // Better Auth's link would send the user back to the API origin after verifying.
          verificationUrl: resolveVerificationUrl(url),
          locale,
        }),
      );
    },
  },
  plugins: [organization(organizationOptions)],
});

export type AuthSession = typeof auth.$Infer.Session;
