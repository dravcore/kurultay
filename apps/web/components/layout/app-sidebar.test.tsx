import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

const workspaceContext = { onSignOut: vi.fn() };
vi.mock('./workspace-provider', () => ({
  useWorkspaceContext: () => workspaceContext,
}));

vi.mock('./workspace-switcher', () => ({
  WorkspaceSwitcher: (): React.ReactElement => <div data-testid="workspace-switcher" />,
}));

vi.mock('./theme-toggle', () => ({
  ThemeToggle: (): React.ReactElement => <div data-testid="theme-toggle" />,
}));

vi.mock('@/components/notification/notification-bell', () => ({
  NotificationBell: (): React.ReactElement => <div data-testid="notification-bell" />,
}));

vi.mock('@/components/auth/email-verification-link', () => ({
  EmailVerificationLink: (): null => null,
}));

import { AppSidebar } from './app-sidebar';

const STORAGE_KEY = 'kurul:sidebar-collapsed';

type MediaChangeListener = () => void;

/**
 * jsdom does not implement `matchMedia` at all, so every test that touches the sidebar's
 * breakpoint listener needs its own stand-in. `matches` is exposed as a live getter — rather
 * than a value fixed at call time — because `AppSidebar`'s `change` handler re-reads
 * `media.matches` off the same object the component holds onto, not off a fresh query.
 */
function installMatchMedia(initialMatches: boolean): {
  fireChange: (matches: boolean) => void;
} {
  let matches = initialMatches;
  const listeners = new Set<MediaChangeListener>();

  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, listener: MediaChangeListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: MediaChangeListener) => {
      listeners.delete(listener);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    fireChange: (next: boolean) => {
      matches = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function renderSidebar() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AppSidebar />
    </NextIntlClientProvider>,
  );
}

function isCollapsed(): boolean {
  // `aria-label` flips between "Collapse sidebar" and "Expand sidebar" with `collapsed`, so
  // it doubles as the state probe — no need to reach into the rendered width class.
  return screen.queryByRole('button', { name: 'Expand sidebar' }) !== null;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AppSidebar collapse state (FE-08)', () => {
  it('follows the breakpoint when nothing has been stored or overridden yet', () => {
    installMatchMedia(true);
    renderSidebar();

    expect(isCollapsed()).toBe(true);
  });

  it('restores a stored preference over the current breakpoint on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    // Wide viewport would default to expanded — the stored preference must win instead.
    installMatchMedia(false);
    renderSidebar();

    expect(isCollapsed()).toBe(true);
  });

  it('persists a manual toggle to storage so a later mount restores it', () => {
    installMatchMedia(false);
    const { unmount } = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(isCollapsed()).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');

    // Simulate a reload: unmount, then mount a fresh instance the way navigation would.
    unmount();
    installMatchMedia(false);
    renderSidebar();

    expect(isCollapsed()).toBe(true);
  });

  it('does not let a breakpoint crossing revert a manual override', () => {
    // Narrow viewport auto-collapses the sidebar first.
    const media = installMatchMedia(true);
    renderSidebar();
    expect(isCollapsed()).toBe(true);

    // The user deliberately expands it anyway, while still below the breakpoint.
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(isCollapsed()).toBe(false);

    // The viewport crosses the breakpoint boundary and fires `change` again. Pre-fix, the
    // listener unconditionally re-applied `media.matches` and silently re-collapsed the
    // sidebar, discarding the choice made a moment earlier.
    act(() => {
      media.fireChange(true);
    });

    expect(isCollapsed()).toBe(false);
  });
});

describe('AppSidebar sign out', () => {
  it('calls the workspace context sign-out when the button is clicked', () => {
    // Expanded: the label-less icon button below the breakpoint has no accessible name to
    // query by, and signing out is not the collapsed rail's contract under test here.
    installMatchMedia(false);
    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(workspaceContext.onSignOut).toHaveBeenCalledTimes(1);
  });
});
