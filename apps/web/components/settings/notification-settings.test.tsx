import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { api } from '@/lib/api';
import { NotificationSettings } from './notification-settings';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { get: vi.fn(), patch: vi.fn() } };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const apiGet = vi.mocked(api.get);
const apiPatch = vi.mocked(api.patch);

function user(emailNotifications: boolean) {
  return {
    id: 'u1',
    email: 'a@b.c',
    name: 'Ada',
    avatarUrl: null,
    locale: null,
    emailNotifications,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function renderSettings() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotificationSettings />
    </NextIntlClientProvider>,
  );
}

const LABEL = messages.app.settings.notifications.emailLabel;

beforeEach(() => {
  apiGet.mockReset();
  apiPatch.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('NotificationSettings', () => {
  it('shows the stored switch as checked for a user who receives email', async () => {
    apiGet.mockResolvedValue(user(true) as never);
    renderSettings();

    const box = await screen.findByLabelText(LABEL);
    expect((box as HTMLInputElement).checked).toBe(true);
  });

  it('shows it unchecked for a user who opted out', async () => {
    apiGet.mockResolvedValue(user(false) as never);
    renderSettings();

    const box = await screen.findByLabelText(LABEL);
    expect((box as HTMLInputElement).checked).toBe(false);
  });

  it('writes the opt-out to the profile and reflects the saved value', async () => {
    apiGet.mockResolvedValue(user(true) as never);
    apiPatch.mockResolvedValue(user(false) as never);
    renderSettings();

    const box = await screen.findByLabelText(LABEL);
    fireEvent.click(box);

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/me', { emailNotifications: false }),
    );
    await waitFor(() => expect((box as HTMLInputElement).checked).toBe(false));
    expect(toastSuccess).toHaveBeenCalledWith(messages.app.settings.notifications.saved);
  });

  it('keeps the stored value on screen when the write fails', async () => {
    // A checkbox that flips on a failed save shows a preference the account does not have.
    apiGet.mockResolvedValue(user(true) as never);
    apiPatch.mockRejectedValue(new Error('network'));
    renderSettings();

    const box = await screen.findByLabelText(LABEL);
    fireEvent.click(box);

    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('reports a failed load instead of rendering an unchecked box', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    renderSettings();

    expect(await screen.findByText(messages.app.settings.notifications.loadError)).toBeTruthy();
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });
});
