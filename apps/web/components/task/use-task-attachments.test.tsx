import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { type AttachmentDto, AttachmentKind, Priority, type TaskDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { toast } from 'sonner';
import { useTaskAttachments } from './use-task-attachments';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d60';
const OTHER_TASK_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d61';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const toastError = vi.mocked(toast.error);

/**
 * The real `lib/api` runs in these tests, and `fetch` is what is faked.
 *
 * Mocking `api` would make the header assertion below vacuous: what it checks is that nothing
 * between the call site and the network writes a `Content-Type` over the multipart boundary the
 * browser generates, and both halves of that — the caller passing no headers and `apiFetch`
 * leaving a `FormData` alone — have to run for the check to mean anything.
 */
const fetchMock = vi.fn();

interface Route {
  method: string;
  match: (url: string) => boolean;
  reply: () => Response | Promise<Response>;
}

let routes: Route[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function attachment(overrides: Partial<AttachmentDto> = {}): AttachmentDto {
  return {
    id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e01',
    taskId: TASK_ID,
    kind: AttachmentKind.File,
    filename: 'contract.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    url: null,
    uploadedById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    id: TASK_ID,
    boardId: 'board-1',
    columnId: 'column-1',
    title: 'Task',
    description: null,
    priority: Priority.MEDIUM,
    position: 1000,
    dueDate: null,
    estimatedMinutes: null,
    createdById: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    checklistSummary: { total: 0, done: 0 },
    checklists: null,
    attachmentCount: 0,
    ...overrides,
  };
}

function route(method: string, fragment: string, reply: Route['reply']): void {
  routes.unshift({ method, match: (url) => url.includes(fragment), reply });
}

function callFor(method: string, fragment: string): [string, RequestInit] | undefined {
  const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
  const found = calls.find(
    ([url, init]) => (init?.method ?? 'GET') === method && String(url).includes(fragment),
  );
  return found === undefined ? undefined : [found[0], found[1] ?? {}];
}

function renderAttachments(initial: TaskDto | null, canMutate = true) {
  const onCountChanged = vi.fn();
  const view = renderHook(
    ({ current }: { current: TaskDto | null }) =>
      useTaskAttachments({
        workspaceId: WORKSPACE_ID,
        task: current,
        canMutate,
        onCountChanged,
      }),
    {
      initialProps: { current: initial },
      wrapper: ({ children }) => (
        <NextIntlClientProvider locale="en" messages={messages}>
          {children}
        </NextIntlClientProvider>
      ),
    },
  );
  return { ...view, onCountChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  routes = [];
  route('GET', '/config', () => json({ mailEnabled: true, attachmentsEnabled: true }));
  route('GET', '/attachments', () => json([]));
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const found = routes.find((entry) => entry.method === method && entry.match(String(url)));
    if (!found)
      return Promise.resolve(json({ statusCode: 404, error: 'Not Found', message: 'x' }, 404));
    return Promise.resolve(found.reply());
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useTaskAttachments', () => {
  it('reads the task its own endpoint rather than expecting rows on the task DTO', async () => {
    const row = attachment();
    route('GET', '/attachments', () => json([row]));

    const { result } = renderAttachments(task());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.attachments).toEqual([row]);
    expect(
      callFor('GET', `/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}/attachments`),
    ).toBeDefined();
  });

  it('reports a failed read instead of an empty list', async () => {
    route('GET', '/attachments', () => json({ statusCode: 500, error: 'x', message: 'x' }, 500));

    const { result } = renderAttachments(task());

    await waitFor(() => expect(result.current.loadFailed).toBe(true));
    // "Failed" and "loading" are exclusive; a panel that reported both would spin forever.
    expect(result.current.loading).toBe(false);
  });

  it('clears the verdict by switching task, without a second effect to reset it', async () => {
    route('GET', '/attachments', () => json({ statusCode: 500, error: 'x', message: 'x' }, 500));
    const { result, rerender } = renderAttachments(task());
    await waitFor(() => expect(result.current.loadFailed).toBe(true));

    routes = routes.filter((entry) => !entry.match('/attachments'));
    route('GET', '/attachments', () => json([]));
    rerender({ current: task({ id: OTHER_TASK_ID }) });

    await waitFor(() => expect(result.current.loadFailed).toBe(false));
  });

  it('lets the browser write the multipart boundary — no header from this call site', async () => {
    route('POST', '/attachments', () => json(attachment(), 201));
    const { result } = renderAttachments(task());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.upload(new File(['x'], 'contract.pdf', { type: 'application/pdf' }));
    });

    const call = callFor('POST', '/attachments');
    expect(call).toBeDefined();
    const [, init] = call!;
    // `apiFetch` only skips the JSON default; a `Content-Type` passed by the caller still wins,
    // and the one it would overwrite carries the boundary the parser needs.
    expect(new Headers(init.headers).get('Content-Type')).toBeNull();
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('kind')).toBe('FILE');
  });

  it('puts the new row first and reports the new count upward', async () => {
    const existing = attachment({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e00' });
    const created = attachment({ id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e0f' });
    route('GET', '/attachments', () => json([existing]));
    route('POST', '/attachments', () => json(created, 201));

    const { result, onCountChanged } = renderAttachments(task());
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));

    await act(async () => {
      await result.current.upload(new File(['x'], 'contract.pdf', { type: 'application/pdf' }));
    });

    // Newest first, matching the server's `id: 'desc'` — the row just added is the row the
    // reader is looking for.
    expect(result.current.attachments.map((row) => row.id)).toEqual([created.id, existing.id]);
    expect(onCountChanged).toHaveBeenCalledWith(TASK_ID, 2);
  });

  it('sends a link as JSON on the same endpoint, with the label only when there is one', async () => {
    route('POST', '/attachments', () => json(attachment({ kind: AttachmentKind.Link }), 201));
    const { result } = renderAttachments(task());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addLink('  https://figma.example/f/1  ', '   ');
    });

    const [, init] = callFor('POST', '/attachments')!;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      kind: 'LINK',
      url: 'https://figma.example/f/1',
    });
  });

  it('does not spend a request on a blank link', async () => {
    const { result } = renderAttachments(task());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.addLink('   ', 'label')).toBe(false);
    });

    expect(callFor('POST', '/attachments')).toBeUndefined();
  });

  it('drops the deleted row and reports the smaller count', async () => {
    const row = attachment();
    route('GET', '/attachments', () => json([row]));
    route('DELETE', '/attachments/', () => new Response(null, { status: 204 }));

    const { result, onCountChanged } = renderAttachments(task());
    await waitFor(() => expect(result.current.attachments).toHaveLength(1));

    await act(async () => {
      await result.current.remove(row.id);
    });

    expect(result.current.attachments).toEqual([]);
    expect(onCountChanged).toHaveBeenCalledWith(TASK_ID, 0);
    expect(callFor('DELETE', `/workspaces/${WORKSPACE_ID}/attachments/${row.id}`)).toBeDefined();
  });

  it('says which limit a rejected upload hit, rather than "could not attach that"', async () => {
    const { result } = renderAttachments(task());
    await waitFor(() => expect(result.current.loading).toBe(false));

    for (const [status, expected] of [
      [413, 'That file is larger than this instance accepts.'],
      [415, 'That file type is not accepted.'],
      [403, "You don't have access to change this task. Ask a workspace admin."],
      [500, 'Could not attach that.'],
    ] as const) {
      toastError.mockClear();
      routes = routes.filter((entry) => entry.method !== 'POST');
      route('POST', '/attachments', () =>
        json({ statusCode: status, error: 'x', message: 'x' }, status),
      );

      await act(async () => {
        expect(await result.current.upload(new File(['x'], 'f.pdf'))).toBe(false);
      });

      expect(toastError).toHaveBeenCalledWith(expected);
    }
  });

  it('tells a full quota apart from a too-large file, though both are 413', async () => {
    // A smaller file cannot fix a full workspace, so showing `tooLarge` here would send the
    // user off to shrink a file that was never the problem. The discriminator is the
    // envelope's `error` string (ADR 0027), which the loop above deliberately does not carry.
    const { result } = renderAttachments(task());
    await waitFor(() => expect(result.current.loading).toBe(false));

    route('POST', '/attachments', () =>
      json({ statusCode: 413, error: 'Attachment Quota Exceeded', message: 'quota' }, 413),
    );

    await act(async () => {
      expect(await result.current.upload(new File(['x'], 'f.pdf'))).toBe(false);
    });

    expect(toastError).toHaveBeenCalledWith(
      "There isn't enough attachment storage left for that file.",
    );
  });

  it('refuses every write for a viewer without reaching the network', async () => {
    const { result } = renderAttachments(task(), false);
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      expect(await result.current.upload(new File(['x'], 'f.pdf'))).toBe(false);
      expect(await result.current.addLink('https://a.example', '')).toBe(false);
      await result.current.remove('0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1e01');
    });

    expect(callFor('POST', '/attachments')).toBeUndefined();
    expect(callFor('DELETE', '/attachments/')).toBeUndefined();
  });

  it('follows the instance config for storage, and keeps the control up when /config fails', async () => {
    routes = routes.filter((entry) => !entry.match('/config'));
    route('GET', '/config', () => json({ mailEnabled: true, attachmentsEnabled: false }));

    const off = renderAttachments(task());
    await waitFor(() => expect(off.result.current.storageEnabled).toBe(false));
    off.unmount();

    routes = routes.filter((entry) => !entry.match('/config'));
    route('GET', '/config', () => json({ statusCode: 500, error: 'x', message: 'x' }, 500));

    const broken = renderAttachments(task());
    await waitFor(() => expect(broken.result.current.loading).toBe(false));
    // An unrelated read failing is not evidence about storage, and the upload endpoint is still
    // the authority. Hiding a working control costs more than one clear error would.
    expect(broken.result.current.storageEnabled).toBe(true);
  });
});
