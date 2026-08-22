# 0005. Realtime: Socket.io + Redis Adapter

**Status:** Accepted
**Date:** 2026-08-08
**Updated:** 2026-08-08 — states when the Redis adapter is actually required, rather than resting on "the standard choice".

> 🌐 English (canonical) | [Türkçe](../tr/decisions/0005-realtime-socketio.md)

## Context

A kanban board needs board/task state to stay in sync across connected clients.
The project already runs its own Postgres and Redis infrastructure rather than
targeting a serverless deployment.

## Decision

**Socket.io** with **`@socket.io/redis-adapter`**, over bare `ws` and over
managed realtime services (Ably, Pusher, Liveblocks).

## Rationale

- With self-hosted infrastructure already in place, Socket.io + the Redis
  adapter is the standard choice: `@socket.io/redis-adapter` fans events out
  across all server processes.
- **The adapter is required earlier than "horizontal scaling" suggests, which
  is why it is wired from the start rather than deferred.** Stage 2 of the
  staged runtime plan
  ([architecture.md §8](../architecture.md#8-runtime-evolution)) splits the
  single process into `api`, `ws`, and `worker` roles. The moment the Socket.io
  gateway is its own process and `api` still emits domain events, those events
  have to cross a process boundary — **with a single `ws` replica**. The
  trigger is a change in deployment shape the architecture already plans, not
  a traffic event that may never arrive. Wiring it is roughly five lines
  (`io.adapter(createAdapter(pubClient, subClient))` plus two Redis clients)
  against a Redis that is already a hard dependency, so there is little cost to
  avoid by waiting — and doing it on day one disciplines the gateway away from
  in-process state (a module-level `Map<socketId, workspaceId>`), which is the
  thing that actually breaks when the adapter is added later.
- **Integrate early while compatibility is known-good.** `@socket.io/redis-adapter`
  is small and feature-complete but slow-moving — its last release was March 2024. Its compatibility with the current socket.io 4.8.x line is known to
  work today; discovering an incompatibility later, under scaling pressure, is
  the expensive version of the same task.
- Bare `ws` has lower overhead but leaves room management and automatic
  reconnection to be hand-built — both are needed anyway for a kanban board's
  multi-client scenario, so the savings don't materialize.
- Managed services (Ably, Pusher, Liveblocks) solve problems specific to
  serverless deployments; they don't apply here since we operate our own
  server infrastructure end to end.
- **Deliberate sequencing:** realtime is placed last in the feature order (see
  the Phase 1 project skeleton, now only in git history) — after auth, boards, tasks,
  task metadata, filtering, and dashboards — because the data flow needs to
  settle first. Wiring sockets in early would mean updating event contracts on
  every subsequent feature change.

## Consequences

- Rooms and reconnection are handled by the library rather than hand-rolled.
- A proven horizontal-scaling path exists via the Redis adapter when multiple
  server instances are needed.
- No vendor lock-in or per-connection managed-service cost.
- Redis pub/sub becomes another load pattern to operate, on top of its caching
  and queue duties.
- The horizontal-scaling story rests on a single slow-moving dependency
  (`@socket.io/redis-adapter`, 8.3.0, March 2024). If it stalls further, the
  fallbacks are the sharded Redis adapter or a hand-rolled pub/sub fan-out —
  both days of work, not an architecture change.
- Deferring realtime to last means socket event contracts aren't validated
  against real usage until late in the build — reworks discovered then could
  ripple back into earlier features.

## Alternatives considered

| Alternative                          | Why not                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Bare `ws`                            | Lower overhead, but rooms and reconnection logic — both needed anyway — would have to be hand-written                         |
| Ably / Pusher / Liveblocks (managed) | Solve serverless scaling problems we don't have; add cost and an external dependency that self-hosted infra makes unnecessary |
