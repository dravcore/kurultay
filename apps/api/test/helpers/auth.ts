import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { uuidv7 } from 'uuidv7';
import { MemberRole } from '@kurul/shared-types';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestUser {
  email: string;
  password: string;
  name: string;
  agent: request.Agent;
}

/**
 * The random tail of a fresh uuidv7 (its 74 CSPRNG bits, minus the 48-bit millisecond
 * timestamp and the version/variant bits), reduced to 12 lowercase hex characters.
 *
 * `uniqueEmail` and `createWorkspace`'s slug used to lean on `Date.now()` plus a few
 * `Math.random()` base36 characters. That's enough entropy to avoid *self*-collisions
 * inside a single `--runInBand` process, but Phase 2 runs multiple agents' e2e suites
 * concurrently against a shared database (#173), and most individual spec files pass
 * `createWorkspace` an EXPLICIT slug shaped like `` `roles-${Date.now()}` `` with no
 * randomness at all — several files reuse the same literal prefix (`roles-`, `a-`,
 * `b-`, ...). Two processes reaching the same spec within the same millisecond then
 * mint the identical string, and since `Workspace.slug` has a global unique
 * constraint, the loser's `POST /workspaces` 409s. A deterministic reproduction (fixed
 * `Date.now()`, tight loop) confirmed both the default generator collides under load
 * and the explicit per-spec pattern collides with certainty whenever two calls land in
 * the same millisecond.
 *
 * uuidv7() closes both: it's already the repo's id-generation convention (`@default
 * (uuid(7))` in schema.prisma, `generateId` in `src/auth/auth.ts`), and its randomness
 * budget makes a same-millisecond collision practically impossible regardless of how
 * many processes are racing. Only the trailing hex is kept — the leading timestamp
 * segment would just re-encode the millisecond `Date.now()` already gave every caller,
 * adding nothing to the uniqueness budget.
 */
export function uniqueSuffix(): string {
  return uuidv7().replace(/-/g, '').slice(-12);
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${uniqueSuffix()}@test.example.com`;
}

export async function signUp(
  app: INestApplication<App>,
  overrides?: Partial<{ email: string; password: string; name: string }>,
): Promise<TestUser> {
  const email = overrides?.email ?? uniqueEmail('user');
  const password = overrides?.password ?? 'password-for-tests-1';
  const name = overrides?.name ?? 'Test User';
  const agent = request.agent(app.getHttpServer());

  const response = await agent.post('/auth/sign-up/email').send({
    email,
    password,
    name,
  });

  if (response.status >= 400) {
    throw new Error(`sign-up failed (${response.status}): ${JSON.stringify(response.body)}`);
  }

  return { email, password, name, agent };
}

export async function signIn(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app.getHttpServer());
  const response = await agent.post('/auth/sign-in/email').send({ email, password });
  if (response.status >= 400) {
    throw new Error(`sign-in failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return agent;
}

/**
 * Marks a test user's address as confirmed and re-signs them in.
 *
 * Accepting an invitation requires a verified email
 * (`requireEmailVerificationOnInvitation` in `src/auth/organization-options.ts`), so every
 * e2e that walks the invite flow has to put its invitee in that state.
 *
 * Flipping the column is not enough on its own: the session cookie caches the user for 60
 * seconds (`session.cookieCache`), so the agent would keep presenting `emailVerified: false`
 * from the cookie it already holds. Signing in again mints a cookie that agrees with the
 * database. The user's `agent` is replaced in place, so callers keep using `user.agent`.
 *
 * The real flow gets here by clicking the link in the verification email; this is the same
 * end state without an SMTP server in the test environment.
 */
export async function confirmEmail(
  app: INestApplication<App>,
  prisma: PrismaService,
  user: TestUser,
): Promise<void> {
  await prisma.user.update({
    where: { email: user.email },
    data: { emailVerified: true },
  });

  user.agent = await signIn(app, user.email, user.password);
}

/**
 * Builds a workspace slug from a caller-supplied *label*, not a literal slug — the
 * label is kept only so DB dumps/logs stay readable when chasing down a specific
 * test's data; nothing in this suite asserts on the exact returned slug.
 * `uniqueSuffix()` is unconditionally appended so no caller can reintroduce the
 * collision this helper exists to prevent, which is also why the ~85 existing
 * `createWorkspace` call sites that already appended their own `Date.now()` don't need
 * to be touched individually — the collision-prone half of what they pass in is now
 * inert, and the safe half (the readable prefix) still works exactly as before.
 *
 * `create-workspace.dto.ts` caps `slug` at 48 characters, so the label is truncated —
 * never the suffix, which is the part actually guaranteeing uniqueness.
 */
export function buildUniqueSlug(label: string): string {
  const suffix = uniqueSuffix();
  const labelBudget = Math.max(0, 48 - suffix.length - 1);
  // An empty (or all-truncated) label would leave the slug starting with the joining
  // hyphen, failing the DTO's `/^[a-z0-9]+.../` pattern (it must start alphanumeric) —
  // fall back to a fixed label rather than let a caller's empty string produce an
  // invalid slug.
  const safeLabel = label.slice(0, labelBudget) || 'ws';
  return `${safeLabel}-${suffix}`;
}

export async function createWorkspace(
  agent: request.Agent,
  name = 'Workspace',
  slugPrefix = 'ws',
): Promise<{ id: string; name: string; slug: string }> {
  const response = await agent.post('/workspaces').send({
    name,
    slug: buildUniqueSlug(slugPrefix),
  });
  if (response.status >= 400) {
    throw new Error(
      `create workspace failed (${response.status}): ${JSON.stringify(response.body)}`,
    );
  }
  return response.body as { id: string; name: string; slug: string };
}

/** Force a membership role for matrix tests (bypasses invite flow). */
export async function setMemberRole(
  prisma: PrismaService,
  workspaceId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await prisma.workspaceMember.update({
    where: {
      workspaceId_userId: { workspaceId, userId },
    },
    data: { role },
  });
}

export async function addMember(
  prisma: PrismaService,
  workspaceId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  await prisma.workspaceMember.create({
    data: { workspaceId, userId, role },
  });
}
