import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { MemberRole, type AccountDeletionPreviewDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { ApiError, api } from '@/lib/api';
import { DeleteAccountDialog } from './delete-account-dialog';

const copy = messages.app.settings.account;

const routerReplace = vi.fn();
const routerRefresh = vi.fn();
const disconnectSocket = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, refresh: routerRefresh }),
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: () => disconnectSocket() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn(), delete: vi.fn() } };
});

const apiGet = vi.mocked(api.get);
const apiDelete = vi.mocked(api.delete);

const EMAIL = 'ada@example.com';
const WORKSPACE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00';
const CANDIDATE_ID = '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d01';

function preview(overrides: Partial<AccountDeletionPreviewDto> = {}): AccountDeletionPreviewDto {
  return {
    userId: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1dff',
    soleOwnedWorkspaces: [],
    otherWorkspaces: [],
    retainedContent: { comments: 3, tasksCreated: 2, attachments: 0, activities: 9 },
    ...overrides,
  };
}

function soleOwned(candidates: { userId: string; name: string }[]): AccountDeletionPreviewDto {
  return preview({
    soleOwnedWorkspaces: [
      {
        workspaceId: WORKSPACE_ID,
        name: 'Kurul',
        slug: 'kurul',
        memberCount: candidates.length + 1,
        boardCount: 2,
        transferCandidates: candidates.map((candidate) => ({
          ...candidate,
          role: MemberRole.MEMBER,
        })),
      },
    ],
  });
}

function apiFailure(statusCode: number): ApiError {
  return new ApiError({ statusCode, error: 'Conflict', message: 'server wording, never shown' });
}

beforeAll(() => {
  // Radix Dialog measures its content; jsdom ships none of the APIs it probes for.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue(preview() as never);
  apiDelete.mockReset();
  routerReplace.mockReset();
  routerRefresh.mockReset();
  disconnectSocket.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog() {
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DeleteAccountDialog open onOpenChange={onOpenChange} email={EMAIL} />
    </NextIntlClientProvider>,
  );
  return { onOpenChange };
}

const confirmField = async (): Promise<HTMLInputElement> =>
  (await screen.findByLabelText(copy.confirmLabel.replace('{email}', EMAIL))) as HTMLInputElement;
const deleteButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: copy.deleteAction }) as HTMLButtonElement;

describe('DeleteAccountDialog', () => {
  it('keeps the delete button disabled until the address is typed exactly', async () => {
    renderDialog();

    expect(deleteButton().disabled).toBe(true);

    fireEvent.change(await confirmField(), { target: { value: 'ada@example.co' } });
    expect(deleteButton().disabled).toBe(true);

    fireEvent.change(await confirmField(), { target: { value: EMAIL } });
    await waitFor(() => expect(deleteButton().disabled).toBe(false));
  });

  it('deletes, drops the socket and sends the user to sign-in', async () => {
    apiDelete.mockResolvedValue(undefined as never);
    const { onOpenChange } = renderDialog();

    fireEvent.change(await confirmField(), { target: { value: EMAIL } });
    fireEvent.click(deleteButton());

    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
    const [path, init] = apiDelete.mock.calls[0]!;
    expect(path).toBe('/me');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      confirmEmail: EMAIL,
      dispositions: [],
    });

    expect(disconnectSocket).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(routerReplace).toHaveBeenCalledWith('/login');
    expect(routerRefresh).toHaveBeenCalled();
  });

  describe('a workspace the user solely owns', () => {
    it('will not submit until the workspace has a decision, even with the address typed', async () => {
      apiGet.mockResolvedValue(soleOwned([{ userId: CANDIDATE_ID, name: 'Grace' }]) as never);
      renderDialog();

      fireEvent.change(await confirmField(), { target: { value: EMAIL } });

      // The address is right and the button is still disabled: the undecided workspace is the
      // only thing holding it, which is the whole point of the API's 409.
      expect(deleteButton().disabled).toBe(true);
      fireEvent.click(deleteButton());
      expect(apiDelete).not.toHaveBeenCalled();
    });

    it('sends a transfer disposition naming the chosen member', async () => {
      apiGet.mockResolvedValue(soleOwned([{ userId: CANDIDATE_ID, name: 'Grace' }]) as never);
      apiDelete.mockResolvedValue(undefined as never);
      renderDialog();

      const select = (await screen.findByLabelText(
        copy.ownedWorkspace
          .replace('{name}', 'Kurul')
          .replace('{members, plural, one {# member} other {# members}}', '2 members')
          .replace('{boards, plural, one {# board} other {# boards}}', '2 boards'),
      )) as HTMLSelectElement;

      // Every option is present before one is chosen: the two people-shaped options are the
      // placeholder and the candidate, plus the delete alternative.
      expect(select.options).toHaveLength(3);

      fireEvent.change(select, { target: { value: CANDIDATE_ID } });
      fireEvent.change(await confirmField(), { target: { value: EMAIL } });
      await waitFor(() => expect(deleteButton().disabled).toBe(false));
      fireEvent.click(deleteButton());

      await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
      const [, init] = apiDelete.mock.calls[0]!;
      expect(JSON.parse((init as { body: string }).body).dispositions).toEqual([
        { workspaceId: WORKSPACE_ID, action: 'transfer', newOwnerUserId: CANDIDATE_ID },
      ]);
    });

    it('sends a delete disposition when that is what was chosen', async () => {
      apiGet.mockResolvedValue(soleOwned([{ userId: CANDIDATE_ID, name: 'Grace' }]) as never);
      apiDelete.mockResolvedValue(undefined as never);
      renderDialog();

      const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
      fireEvent.change(select, { target: { value: 'delete' } });
      fireEvent.change(await confirmField(), { target: { value: EMAIL } });
      fireEvent.click(deleteButton());

      await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
      const [, init] = apiDelete.mock.calls[0]!;
      expect(JSON.parse((init as { body: string }).body).dispositions).toEqual([
        { workspaceId: WORKSPACE_ID, action: 'delete' },
      ]);
    });

    it('says so when there is nobody to hand the workspace to, and offers only deletion', async () => {
      apiGet.mockResolvedValue(soleOwned([]) as never);
      renderDialog();

      expect(await screen.findByText(copy.ownedNobodyLeft)).toBeTruthy();
      const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
      // Placeholder plus "delete", and no transfer option — the API would answer 404 for one.
      expect(select.options).toHaveLength(2);
      expect([...select.options].map((option) => option.value)).toEqual(['', 'delete']);
    });
  });

  describe('failures', () => {
    it('shows the scoped 409 wording and never the raw server message', async () => {
      apiDelete.mockRejectedValue(apiFailure(409));
      renderDialog();

      fireEvent.change(await confirmField(), { target: { value: EMAIL } });
      fireEvent.click(deleteButton());

      expect(await screen.findByText(copy.deleteErrorUndecided)).toBeTruthy();
      expect(screen.queryByText('server wording, never shown')).toBeNull();
      expect(routerReplace).not.toHaveBeenCalled();
    });

    it('shows the scoped 403 wording when the confirmation address is refused', async () => {
      apiDelete.mockRejectedValue(apiFailure(403));
      renderDialog();

      fireEvent.change(await confirmField(), { target: { value: EMAIL } });
      fireEvent.click(deleteButton());

      expect(await screen.findByText(copy.deleteErrorConfirm)).toBeTruthy();
    });

    it('announces the failed deletion to assistive tech and moves focus to it', async () => {
      apiDelete.mockRejectedValue(apiFailure(403));
      renderDialog();

      fireEvent.change(await confirmField(), { target: { value: EMAIL } });
      fireEvent.click(deleteButton());

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(copy.deleteErrorConfirm);
      await waitFor(() => expect(document.activeElement).toBe(alert));
    });

    it('refuses to offer the deletion at all when the preview could not load', async () => {
      apiGet.mockRejectedValue(apiFailure(500));
      renderDialog();

      expect(await screen.findByText(copy.loadError)).toBeTruthy();
      // No confirmation field to fill in, so the button cannot be enabled: a deletion whose
      // owned-workspace questions were never asked is exactly what the 409 exists to stop.
      expect(screen.queryByLabelText(copy.confirmLabel.replace('{email}', EMAIL))).toBeNull();
      expect(deleteButton().disabled).toBe(true);
    });
  });
});
