import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { ConfirmDialog, type ConfirmDialogProps } from './confirm-dialog';

beforeAll(() => {
  // Radix Dialog measures and focus-traps its content; jsdom ships neither.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  Element.prototype.scrollIntoView ??= vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

type Overrides = Partial<ConfirmDialogProps>;

function renderDialog(overrides: Overrides = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn().mockResolvedValue(undefined);
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const props: ConfirmDialogProps = {
    open: true,
    onOpenChange,
    title: 'Delete column',
    description: 'This cannot be undone.',
    cancelLabel: 'Cancel',
    confirmLabel: 'Delete',
    onConfirm,
    resolveError: (caught) => `failed: ${String(caught)}`,
    ...overrides,
  };

  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ConfirmDialog {...props} />
    </NextIntlClientProvider>,
  );

  const rerender = (next: Overrides): void => {
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ConfirmDialog {...props} {...next} />
      </NextIntlClientProvider>,
    );
  };

  return { onConfirm, onOpenChange, rerender };
}

const confirmButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;

describe('ConfirmDialog', () => {
  it('shows the title and the reason the action matters', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: 'Delete column' })).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
  });

  it('runs the action and closes when it resolves', async () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.click(confirmButton());

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the dialog open and explains why when the action rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    const { onOpenChange } = renderDialog({ onConfirm });

    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText(/failed: Error: boom/)).toBeTruthy());
    // Rejecting must not close it — the message would go with it.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('announces the failure to assistive tech and moves focus to it', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    renderDialog({ onConfirm });

    fireEvent.click(confirmButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/failed: Error: boom/);
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('re-enables the confirm button after a failure', async () => {
    // The `finally` that is easy to drop: without it the dialog sits behind a dead button
    // with no way to retry.
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    renderDialog({ onConfirm });

    fireEvent.click(confirmButton());

    await waitFor(() => expect(screen.getByText(/failed:/)).toBeTruthy());
    expect(confirmButton().disabled).toBe(false);
  });

  it('does not still show the previous failure when reopened', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('boom'));
    const { rerender } = renderDialog({ onConfirm });

    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByText(/failed:/)).toBeTruthy());

    rerender({ open: false });
    rerender({ open: true });

    await waitFor(() => expect(screen.queryByText(/failed:/)).toBeNull());
  });

  it('blocks the action while the caller says it is not allowed', () => {
    renderDialog({ confirmDisabled: true });

    expect(confirmButton().disabled).toBe(true);
  });

  it('closes without running the action when cancelled', () => {
    const { onConfirm, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
