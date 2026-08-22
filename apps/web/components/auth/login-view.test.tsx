import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  refresh: vi.fn(),
  signInEmail: vi.fn<(args: { email: string; password: string }) => Promise<{ error: unknown }>>(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock('@/lib/auth', () => ({
  authClient: { signIn: { email: mocks.signInEmail } },
}));

import { LoginView } from './login-view';

function renderView(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoginView />
    </NextIntlClientProvider>,
  );
}

function fillCredentials(): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ayse@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

beforeEach(() => {
  mocks.searchParams = new URLSearchParams();
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.signInEmail.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe('LoginView', () => {
  it('offers the sign-up route to a visitor without an account', () => {
    renderView();

    expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe('/register');
  });

  it('signs in with the typed credentials and lands on the dashboard', async () => {
    renderView();
    fillCredentials();

    submit();

    await waitFor(() =>
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: 'ayse@example.com',
        password: 'correct-horse',
      }),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'));
    // Without the refresh the server components keep the signed-out render.
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('keeps the visitor on the form when the credentials are refused', async () => {
    mocks.signInEmail.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    renderView();
    fillCredentials();

    submit();

    expect(
      await screen.findByText('Could not sign in. Check your email and password.'),
    ).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('announces the refused sign-in to assistive tech and moves focus to it', async () => {
    mocks.signInEmail.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    renderView();
    fillCredentials();

    submit();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Could not sign in. Check your email and password.');
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('returns an invitee to the invitation they were sent to sign in from', async () => {
    mocks.searchParams = new URLSearchParams('next=%2Finvite%2Fabc');
    renderView();
    fillCredentials();

    submit();

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/invite/abc'));
  });

  it('carries the destination across to sign-up, so an invitee without an account keeps it', () => {
    mocks.searchParams = new URLSearchParams('next=%2Finvite%2Fabc');
    renderView();

    expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe(
      `/register?next=${encodeURIComponent('/invite/abc')}`,
    );
  });

  it.each([
    ['an absolute URL', 'https://evil.com'],
    ['a protocol-relative URL', '//evil.com'],
  ])('ignores %s and falls back to the dashboard', async (_case, hostile) => {
    mocks.searchParams = new URLSearchParams([['next', hostile]]);
    renderView();
    fillCredentials();

    submit();

    // Honouring it would make our own sign-in form a phishing hop: credentials entered on the
    // real site, then a hand-off to whoever wrote the link.
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'));
    expect(mocks.replace).not.toHaveBeenCalledWith(hostile);
    expect(screen.getByRole('link', { name: 'Create one' }).getAttribute('href')).toBe('/register');
  });
});
