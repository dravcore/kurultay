-- Make the `AttachmentKind` invariant a rule the database keeps, not one the application
-- remembers.
--
-- ADR 0024 chose `kind` as a column precisely so the nullability of `storageKey`, `mimeType`,
-- `size` and `url` could be *derived from it*: "it makes an invariant that the database could
-- enforce into one that only the application remembers. Nothing stops a row with both a `url`
-- and a `storageKey`, or with neither, and the first such row is created by an importer running
-- a bulk insert at three in the morning." The enum shipped in 20260815000000_add_attachment;
-- the enforcement did not. Until this migration the four columns were plainly nullable and the
-- only thing holding the shape together was that `AttachmentService.createFile` and
-- `createLink` each happened to write the right nulls (audit finding DB-02).
--
-- The importer is the case the ADR named and the one that does not go through those methods:
-- `import/trello-import.service.ts` bulk-writes attachment rows with `createMany` from a plan
-- built in `trello-import-planner.ts`. It writes `kind: LINK` with the other three columns
-- explicitly null today — this constraint is what keeps that true after the next edit to a file
-- that has no attachment tests of its own.
--
-- **Raw SQL because Prisma's schema language cannot express a CHECK constraint**, the same
-- reason ADR 0017 gives for the partial index in 20260809180000_due_soon_perf_indexes. That ADR's
-- other half applies here too and is not optional: the object exists in a migration and nowhere
-- in `schema.prisma`, so `test/attachment-kind-check.e2e-spec.ts` asserts both that it is present
-- in `pg_constraint` and that it still rejects the rows it exists to reject. Measured against the
-- CI drift gate before writing this: `prisma migrate diff --from-config-datasource --to-schema
-- --exit-code` reports "No difference detected" with the constraint applied, exactly as it does
-- for the partial index — Prisma does not model CHECK constraints, so it does not see one to
-- diff. The guard test is therefore the only mechanism that notices if it goes.
--
-- Validating rather than `NOT VALID`: every row this schema has ever been able to hold was
-- written by one of the three paths above, all of which satisfy the predicate, so there is
-- nothing to grandfather. An instance that somehow does hold a violating row should fail this
-- migration loudly at upgrade time — a silently un-validated constraint would leave that row in
-- place and still claim the invariant holds.

-- AddCheckConstraint
ALTER TABLE "Attachment"
ADD CONSTRAINT "Attachment_kind_fields_check" CHECK (
  (
    "kind" = 'FILE'
    AND "storageKey" IS NOT NULL
    AND "mimeType" IS NOT NULL
    AND "size" IS NOT NULL
    AND "url" IS NULL
  )
  OR (
    "kind" = 'LINK'
    AND "url" IS NOT NULL
    AND "storageKey" IS NULL
    AND "mimeType" IS NULL
    AND "size" IS NULL
  )
);
