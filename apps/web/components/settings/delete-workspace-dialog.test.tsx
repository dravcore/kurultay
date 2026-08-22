import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { WorkspaceDto } from '@kurul/shared-types';
import messages from '@/messages/en.json';
import { ApiError, api } from '@/lib/api';
import { DeleteWorkspaceDialog } from './delete-workspace-dialog';

const copy = messages.app.settings.workspace;

const routerReplace = vi.fn();
const routerRefresh = vi.fn();
const setActive = vi.fn();
const disconnectSocket = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, refresh: routerRefresh }),
}));
vi.mock('@/lib/auth', () => ({
  authClient: { organization: { setActive: (...args: unknown[]) => setActive(...args) } },
}));
vi.mock('@/lib/socket', () => ({ disconnectSocket: () => disconnectSocket() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { delete: vi.fn() } };
});

const apiDelete = vi.mocked(api.delete);

const workspace: WorkspaceDto = {
  id: '0198e2c0-9a1b-7f04-8c3d-2b5e7a9c1d00',
  name: 'Kurul',
  slug: 'kurul',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function apiFailure(statusCode: number): ApiError {
  return new ApiError({ statusCode, error: 'Forbidden', message: 'server wording, never shown' });
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
  apiDelete.mockReset();
  routerReplace.mockReset();
  routerRefresh.mockReset();
  setActive.mockReset().mockResolvedValue(undefined);
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
      <DeleteWorkspaceDialog open onOpenChange={onOpenChange} workspace={workspace} />
    </NextIntlClientProvider>,
  );
  return { onOpenChange };
}

const confirmField = (): HTMLInputElement =>
  screen.getByLabelText(
    copy.deleteConfirmLabel.replace('{name}', workspace.name),
  ) as HTMLInputElement;
const deleteButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: copy.deleteAction }) as HTMLButtonElement;

describe('DeleteWorkspaceDialog', () => {
  it('keeps the delete button disabled until the workspace name is typed exactly', () => {
    renderDialog();

    expect(deleteButton().disabled).toBe(true);

    fireEvent.change(confirmField(), { target: { value: 'kurul' } });
    expect(deleteButton().disabled).toBe(true);

    fireEvent.change(confirmField(), { target: { value: 'Kurul Labs' } });
    expect(deleteButton().disabled).toBe(true);

    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('never calls the endpoint from a mistyped confirmation click', () => {
    renderDialog();

    fireEvent.change(confirmField(), { target: { value: 'kurul' } });
    // The button stays disabled, so a click event never reaches its handler at all.
    fireEvent.click(deleteButton());

    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('enables the button on an exact match, deletes, and redirects to the dashboard', async () => {
    apiDelete.mockResolvedValue(undefined as never);
    const { onOpenChange } = renderDialog();

    fireEvent.change(confirmField(), { target: { value: workspace.name } });
    expect(deleteButton().disabled).toBe(false);
    fireEvent.click(deleteButton());

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith(`/workspaces/${workspace.id}`));
    await waitFor(() => expect(setActive).toHaveBeenCalledWith({ organizationId: null }));
    expect(disconnectSocket).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(routerReplace).toHaveBeenCalledWith('/dashboard');
    expect(routerRefresh).toHaveBeenCalled();
  });

  it('shows the scoped 403 wording and never the raw server message', async () => {
    apiDelete.mockRejectedValue(apiFailure(403));
    renderDialog();

    fireEvent.change(confirmField(), { target: { value: workspace.name } });
    fireEvent.click(deleteButton());

    expect(await screen.findByText(copy.deleteErrorForbidden)).toBeTruthy();
    expect(screen.queryByText('server wording, never shown')).toBeNull();
    expect(routerReplace).not.toHaveBeenCalled();
  });

  it('announces the failed deletion to assistive tech and moves focus to it', async () => {
    apiDelete.mockRejectedValue(apiFailure(403));
    renderDialog();

    fireEvent.change(confirmField(), { target: { value: workspace.name } });
    fireEvent.click(deleteButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(copy.deleteErrorForbidden);
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });
});
