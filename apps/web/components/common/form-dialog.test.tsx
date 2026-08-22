import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { FormDialog, type FormDialogProps } from './form-dialog';

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

type Overrides = Partial<FormDialogProps>;

function renderDialog(overrides: Overrides = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn().mockResolvedValue(undefined);
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const props: FormDialogProps = {
    open: true,
    onOpenChange,
    title: 'Rename board',
    cancelLabel: 'Cancel',
    submitLabel: 'Save',
    onSubmit,
    resolveError: (caught) => `failed: ${String(caught)}`,
    children: <input aria-label="Name" defaultValue="Roadmap" />,
    ...overrides,
  };

  const view = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FormDialog {...props} />
    </NextIntlClientProvider>,
  );

  const rerender = (next: Overrides): void => {
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FormDialog {...props} {...next} />
      </NextIntlClientProvider>,
    );
  };

  return { onSubmit, onOpenChange, rerender };
}

const submitButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

describe('FormDialog', () => {
  it('renders the title and the caller’s fields', () => {
    renderDialog();

    expect(screen.getByRole('heading', { name: 'Rename board' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });

  it('submits and closes when the request resolves', async () => {
    const { onSubmit, onOpenChange } = renderDialog();

    fireEvent.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the dialog open with the fields intact when the request rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'));
    const { onOpenChange } = renderDialog({ onSubmit });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Q3 plan' } });
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/failed: Error: boom/)).toBeTruthy());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Losing what was typed on a failed save is the regression worth pinning down.
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Q3 plan');
  });

  it('announces the failure to assistive tech and moves focus to it', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'));
    renderDialog({ onSubmit });

    fireEvent.click(submitButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/failed: Error: boom/);
    await waitFor(() => expect(document.activeElement).toBe(alert));
  });

  it('re-enables the submit button after a failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'));
    renderDialog({ onSubmit });

    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByText(/failed:/)).toBeTruthy());
    expect(submitButton().disabled).toBe(false);
  });

  it('does not still show the previous failure when reopened', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'));
    const { rerender } = renderDialog({ onSubmit });

    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByText(/failed:/)).toBeTruthy());

    rerender({ open: false });
    rerender({ open: true });

    await waitFor(() => expect(screen.queryByText(/failed:/)).toBeNull());
  });

  it('honours the caller’s field-level validity', () => {
    renderDialog({ submitDisabled: true });

    expect(submitButton().disabled).toBe(true);
  });

  it('closes without submitting when cancelled', () => {
    const { onSubmit, onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits on Enter in a field, without reloading the page', async () => {
    // The whole reason the fields sit inside a real <form>.
    const { onSubmit } = renderDialog();
    const form = screen.getByLabelText('Name').closest('form') as HTMLFormElement;
    const event = new Event('submit', { bubbles: true, cancelable: true });

    form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });
});
