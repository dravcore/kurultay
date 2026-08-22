import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { TrelloImportReportDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { ApiError, api } from '@/lib/api';
import { ImportTrelloDialog } from './import-trello-dialog';

const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, postForm: vi.fn() } };
});

const postForm = vi.mocked(api.postForm);

const REPORT: TrelloImportReportDto = {
  boardId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d10',
  boardName: 'Product roadmap',
  imported: { columns: 3, tasks: 7, labels: 2, checklists: 0, checklistItems: 0, attachments: 0 },
  skipped: [],
};

function renderDialog(overrides: { onImported?: (r: TrelloImportReportDto) => void } = {}): {
  onOpenChange: ReturnType<typeof vi.fn>;
  onImported: (r: TrelloImportReportDto) => void;
} {
  const onOpenChange = vi.fn();
  const onImported = overrides.onImported ?? vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ImportTrelloDialog
        open
        onOpenChange={onOpenChange}
        workspaceId={WORKSPACE_ID}
        onImported={onImported}
      />
    </NextIntlClientProvider>,
  );
  return { onOpenChange, onImported };
}

function pick(name = 'trello.json'): File {
  const file = new File(['{}'], name, { type: 'application/json' });
  const input = screen.getByLabelText(messages.app.board.import.file);
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', {
    name: messages.app.board.import.submit,
  }) as HTMLButtonElement;
}

beforeEach(() => {
  postForm.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ImportTrelloDialog', () => {
  /**
   * The user-facing half of "there is no idempotency" (ADR 0025). Said afterwards it explains a
   * mess; said here it prevents one — so the assertion is that it is on screen *before* anything
   * has been sent, not merely that the string exists somewhere.
   */
  it('warns that a second import makes a second board, before the file is sent', () => {
    renderDialog();

    expect(screen.getByText(/creates a second board/i)).toBeDefined();
    expect(postForm).not.toHaveBeenCalled();
  });

  it('warns that the wait is long and uncancellable, before the file is sent', () => {
    renderDialog();

    expect(screen.getByText(/cannot be cancelled/i)).toBeDefined();
    expect(postForm).not.toHaveBeenCalled();
  });

  it('will not submit until a file has been picked', () => {
    renderDialog();

    expect(submitButton().disabled).toBe(true);
    pick();
    expect(submitButton().disabled).toBe(false);
  });

  it('posts the picked file to the import endpoint as multipart', async () => {
    postForm.mockResolvedValue(REPORT);
    renderDialog();
    const file = pick();

    fireEvent.click(submitButton());

    await waitFor(() => expect(postForm).toHaveBeenCalled());
    const call = postForm.mock.calls[0];
    expect(call?.[0]).toBe(`/workspaces/${WORKSPACE_ID}/imports/trello`);
    const body = call?.[1];
    expect(body).toBeInstanceOf(FormData);
    // The field name is the contract with `FileInterceptor('file')`; anything else arrives as
    // no file at all and the endpoint answers 400.
    expect((body as FormData).get('file')).toBe(file);
    // Nothing beyond the body. `apiFetch` leaves a `FormData` Content-Type to the browser, but a
    // header passed by a caller still wins — and the one it would overwrite carries the
    // multipart boundary, so a caller-set header produces a request no parser can read.
    expect(call?.[2]).toBeUndefined();
  });

  it('hands the whole report up and closes once the import returns', async () => {
    postForm.mockResolvedValue(REPORT);
    const { onImported, onOpenChange } = renderDialog();
    pick();

    fireEvent.click(submitButton());

    await waitFor(() => expect(onImported).toHaveBeenCalledWith(REPORT));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers no way out while the request is in flight, and says why', async () => {
    let settle: ((value: TrelloImportReportDto) => void) | undefined;
    postForm.mockImplementation(
      () =>
        new Promise<TrelloImportReportDto>((resolve) => {
          settle = resolve;
        }),
    );
    renderDialog();
    pick();

    const cancel = screen.getByRole('button', {
      name: messages.app.board.import.cancel,
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);

    fireEvent.click(submitButton());

    // A Cancel that does not cancel is worse than none: the request keeps running and the board
    // still gets created (ADR 0025 — the import is synchronous and has no queue to abort).
    await waitFor(() => expect(cancel.disabled).toBe(true));
    expect(submitButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('cannot be cancelled');

    settle?.(REPORT);
    await waitFor(() => expect(cancel.disabled).toBe(false));
  });

  it('keeps the dialog open and explains a rejected file instead of reporting a board', async () => {
    postForm.mockRejectedValue(
      new ApiError({ statusCode: 400, error: 'Bad Request', message: 'not a Trello export' }),
    );
    const { onImported, onOpenChange } = renderDialog();
    pick();

    fireEvent.click(submitButton());

    expect(await screen.findByText(messages.app.board.import.badFile)).toBeDefined();
    expect(onImported).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('announces the rejected file to assistive tech and moves focus to it', async () => {
    postForm.mockRejectedValue(
      new ApiError({ statusCode: 400, error: 'Bad Request', message: 'not a Trello export' }),
    );
    renderDialog();
    pick();

    fireEvent.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(messages.app.board.import.badFile);
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('names the role problem rather than blaming the file when the API says 403', async () => {
    postForm.mockRejectedValue(
      new ApiError({ statusCode: 403, error: 'Forbidden', message: 'forbidden' }),
    );
    renderDialog();
    pick();

    fireEvent.click(submitButton());

    expect(await screen.findByText(messages.app.board.import.forbidden)).toBeDefined();
    expect(screen.queryByText(messages.app.board.import.badFile)).toBeNull();
  });

  it('names the size problem when the export is over the limit', async () => {
    postForm.mockRejectedValue(
      new ApiError({ statusCode: 413, error: 'Payload Too Large', message: 'too large' }),
    );
    renderDialog();
    pick();

    fireEvent.click(submitButton());

    expect(await screen.findByText(messages.app.board.import.tooLarge)).toBeDefined();
  });

  it('falls back to a generic failure for a status it has no sentence for', async () => {
    postForm.mockRejectedValue(new Error('network'));
    renderDialog();
    pick();

    fireEvent.click(submitButton());

    expect(await screen.findByText(messages.app.board.import.error)).toBeDefined();
  });
});
