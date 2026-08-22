import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/app';

/**
 * Guards the integration harness itself.
 *
 * supertest manages the HTTP server's lifecycle only when it finds it unbound: `new Test(...)`
 * calls `server.listen(0)` whenever `server.address()` is null, and `Test#end` closes that
 * server again once the response lands. A test app that is only `init()`ed is never bound, so
 * every request re-bound the shared Nest server on a fresh ephemeral port and tore it down
 * again — ~192 bind/teardown cycles for a single spec file. That churn made the whole e2e
 * suite intermittently fail with `socket hang up`, `read ECONNRESET`, or
 * `Parse Error: Expected HTTP/, RTSP/ or ICE/` on whichever request lost the race.
 *
 * `createTestApp` therefore binds once. These assertions fail if that ever regresses.
 *
 * The last test guards the harness's module resolution instead: `jest-e2e.config.cjs` maps
 * the workspace packages to their `src`, the same way `jest.config.cjs` does for the unit
 * suite (see `src/workspace-packages.spec.ts`), so the integration suite can never run against
 * a missing or stale `dist` under `packages/`.
 */
describe('E2E harness (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function boundPort(): number | undefined {
    const address = (app.getHttpServer() as Server).address();
    return typeof address === 'object' && address !== null ? address.port : undefined;
  }

  it('binds the HTTP server before any request is made', () => {
    expect(boundPort()).toEqual(expect.any(Number));
  });

  it('serves every request from the same listener instead of rebinding per request', async () => {
    const before = boundPort();
    const agent = request.agent(app.getHttpServer());

    await agent.get('/health').expect(200);
    await agent.get('/health').expect(200);
    await agent.get('/health').expect(200);

    const after = boundPort();
    // Still bound at all — supertest closes any server it had to open itself.
    expect(after).toEqual(expect.any(Number));
    // ...and bound to the same port, i.e. it was never torn down and re-listened.
    expect(after).toBe(before);
  });

  it('resolves the workspace packages to their source, not dist', () => {
    expect(require.resolve('@kurul/shared-types')).toMatch(
      /[\\/]packages[\\/]shared-types[\\/]src[\\/]index\.ts$/,
    );
    expect(require.resolve('@kurul/auth-access')).toMatch(
      /[\\/]packages[\\/]auth-access[\\/]src[\\/]index\.ts$/,
    );
  });
});
