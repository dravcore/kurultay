'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ATTACHMENT_QUOTA_ERROR,
  type AttachmentDto,
  AttachmentKind,
  type CreateAttachmentLinkRequest,
  type TaskDto,
} from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { fetchInstanceConfig } from '@/lib/instance-config';

export interface UseTaskAttachmentsOptions {
  workspaceId: string;
  /** The task the panel is showing, or `null` while there is none. */
  task: TaskDto | null;
  canMutate: boolean;
  /**
   * The task's attachment count after a write, so the board card's badge follows the panel.
   *
   * A count rather than the rows, because that is all `TaskDto` carries (decision D2) and all
   * the card renders.
   */
  onCountChanged: (taskId: string, attachmentCount: number) => void;
}

export interface UseTaskAttachmentsResult {
  attachments: AttachmentDto[];
  /** The API stores files at all. `false` hides the upload control; links keep working. */
  storageEnabled: boolean;
  /** The list read is in flight; `attachments` is a placeholder, not an answer. */
  loading: boolean;
  loadFailed: boolean;
  /** A write is in flight. */
  pending: boolean;
  upload: (file: File) => Promise<boolean>;
  addLink: (url: string, label: string) => Promise<boolean>;
  remove: (attachmentId: string) => Promise<void>;
}

/**
 * The attachments of the task the panel is showing.
 *
 * Deliberately *not* shaped like `use-task-checklists`, and the difference is one decision:
 * checklists ride on the task DTO (`task.checklists === null` means "not loaded"), attachments
 * have their own endpoint and their own state here. `TaskDto` carries only `attachmentCount`,
 * because the board card needs the number and nothing on the board needs the rows — loading
 * them into the list read is what P2-8 spent a task undoing (ADR 0024, decision D2).
 *
 * Everything else is copied on purpose: the `AbortController` so a fast task switch cannot land
 * a stale list, `failedTaskId`/`loadedTaskId` rather than booleans so switching tasks clears the
 * verdict by arithmetic instead of a cascading `setState`, and a `write()` wrapper that owns
 * `pending` and the toast so no call site can forget either.
 *
 * `storageEnabled` is read once per mounted panel from `GET /config` rather than being derived
 * from anything on the task: whether this instance persists bytes is a property of the
 * deployment (`STORAGE_PATH`), and a task looks identical either way.
 */
export function useTaskAttachments({
  workspaceId,
  task,
  canMutate,
  onCountChanged,
}: UseTaskAttachmentsOptions): UseTaskAttachmentsResult {
  const t = useTranslations('app.board.task.attachments');
  const taskId = task?.id ?? null;

  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  const [loadedTaskId, setLoadedTaskId] = useState<string | null>(null);
  const [failedTaskId, setFailedTaskId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Optimistic in the safe direction: an instance that stores nothing answers the upload with a
   * clear failure, whereas hiding the control until `/config` comes back makes it appear a beat
   * after the panel on every open. The read below corrects it either way.
   */
  const [storageEnabled, setStorageEnabled] = useState(true);

  const loadFailed = failedTaskId !== null && failedTaskId === taskId;
  // Derived rather than stored, for the same reason `use-task-checklists` derives it: a stored
  // copy is a second source of truth that can disagree with the task prop for a frame.
  const loading = taskId !== null && loadedTaskId !== taskId && !loadFailed;

  /**
   * The list, but only for the task it was read for.
   *
   * Derived instead of cleared from the read effect, which is the difference between showing
   * the previous task's files for one frame and never showing them: a `setState` in the effect
   * body runs after the render that already painted them, and `react-hooks/set-state-in-effect`
   * says so.
   *
   * **This is a deliberate difference from `use-task-checklists`, not a stylistic one.** That
   * hook has no equivalent line because its list lives on the task prop — switching task
   * switches the data by itself. Here the list is local state, so "whose list is this" has to
   * be answered somewhere, and answering it by arithmetic against `loadedTaskId` is the version
   * the lint rule permits.
   *
   * `useMemo` for one reason only: so the empty case is a stable array rather than a new one
   * per render. `write` closes over this value, and a fresh `[]` each time would hand every
   * write callback a new identity on every render of the panel.
   */
  const rows = useMemo(
    () => (loadedTaskId === taskId ? attachments : []),
    [loadedTaskId, taskId, attachments],
  );

  // Held in a ref so the read effect does not re-run — and re-request — every time the board
  // hands the panel a new callback identity. Written from an effect rather than during render:
  // a ref assigned while rendering is invisible to React's own bookkeeping.
  const onCountChangedRef = useRef(onCountChanged);
  useEffect(() => {
    onCountChangedRef.current = onCountChanged;
  }, [onCountChanged]);

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      try {
        const config = await fetchInstanceConfig({ signal: controller.signal });
        if (controller.signal.aborted) return;
        setStorageEnabled(config.attachmentsEnabled);
      } catch {
        // A `/config` that will not answer says nothing about storage, and the upload endpoint
        // is still the authority. Leaving the control up costs one clear error; taking it down
        // hides a working feature because an unrelated read failed.
      }
    })();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (taskId === null) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const rows = await api.get<AttachmentDto[]>(
          `/workspaces/${workspaceId}/tasks/${taskId}/attachments`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setFailedTaskId(null);
        setAttachments(rows);
        setLoadedTaskId(taskId);
      } catch {
        if (controller.signal.aborted) return;
        setFailedTaskId(taskId);
      }
    })();

    return () => controller.abort();
  }, [workspaceId, taskId]);

  /**
   * One write, its `pending` flag, its error message and the count the card reads.
   *
   * `run` is handed the current list and returns the next one, so each caller says what the
   * write does to the list in the same place it performs it — and the count reported upward is
   * always the length of the list actually rendered, never a number computed twice.
   */
  const write = useCallback(
    async (run: (current: AttachmentDto[]) => Promise<AttachmentDto[]>): Promise<boolean> => {
      if (taskId === null) return false;
      setPending(true);
      try {
        const next = await run(rows);
        setAttachments(next);
        onCountChangedRef.current(taskId, next.length);
        return true;
      } catch (caught) {
        toast.error(
          resolveApiMessage(caught, t, {
            fallback: 'saveError',
            // A quota 413 and a size-limit 413 ask the user for different things — a smaller
            // file cannot fix a full workspace — so the quota is told apart by the envelope's
            // `error` before the status is consulted (ADR 0027).
            byError: { [ATTACHMENT_QUOTA_ERROR]: 'quotaExceeded' },
            byStatus: { 403: 'forbidden', 413: 'tooLarge', 415: 'wrongType' },
          }),
        );
        return false;
      } finally {
        setPending(false);
      }
    },
    [rows, taskId, t],
  );

  const upload = useCallback(
    async (file: File): Promise<boolean> => {
      if (!canMutate || taskId === null) return false;
      return write(async (current) => {
        const body = new FormData();
        body.append('kind', AttachmentKind.File);
        body.append('file', file);
        // No `init` and above all no headers: `apiFetch` leaves a `FormData` body's
        // `Content-Type` to the browser, but a header passed by a caller still wins, and the
        // one it would overwrite carries the multipart boundary.
        const created = await api.postForm<AttachmentDto>(
          `/workspaces/${workspaceId}/tasks/${taskId}/attachments`,
          body,
        );
        // Newest first, matching the server's `id: 'desc'` (decision D1), so the row the user
        // just added is the row they are looking at.
        return [created, ...current];
      });
    },
    [canMutate, taskId, workspaceId, write],
  );

  const addLink = useCallback(
    async (url: string, label: string): Promise<boolean> => {
      if (!canMutate || taskId === null) return false;
      const trimmedUrl = url.trim();
      // Stops an empty submit from becoming a round trip. Not a scheme check: `http:`/`https:`
      // is enforced on the server (K7), and a client-side copy of it would read like the
      // authority it is not.
      if (trimmedUrl.length === 0) return false;
      const filename = label.trim();

      return write(async (current) => {
        const created = await api.post<AttachmentDto, CreateAttachmentLinkRequest>(
          `/workspaces/${workspaceId}/tasks/${taskId}/attachments`,
          {
            kind: AttachmentKind.Link,
            url: trimmedUrl,
            ...(filename.length > 0 ? { filename } : {}),
          },
        );
        return [created, ...current];
      });
    },
    [canMutate, taskId, workspaceId, write],
  );

  const remove = useCallback(
    async (attachmentId: string): Promise<void> => {
      if (!canMutate || taskId === null) return;
      await write(async (current) => {
        await api.delete(`/workspaces/${workspaceId}/attachments/${attachmentId}`);
        return current.filter((row) => row.id !== attachmentId);
      });
    },
    [canMutate, taskId, workspaceId, write],
  );

  return {
    attachments: rows,
    storageEnabled,
    loading,
    loadFailed,
    pending,
    upload,
    addLink,
    remove,
  };
}
