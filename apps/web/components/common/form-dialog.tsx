'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SubmitError } from '@/components/common/submit-error';

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  cancelLabel: string;
  submitLabel: string;
  /** Field-level validity. The submit button is disabled while the request is in flight too. */
  submitDisabled?: boolean;
  /**
   * Focused when the dialog opens, in place of Radix's default (the content wrapper).
   *
   * Routed through `onOpenAutoFocus` rather than an `autoFocus` attribute: `autoFocus` is a
   * `jsx-a11y/no-autofocus` error, and setting focus from an effect races Radix's own
   * focus-management pass.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Runs the submission. Resolving closes the dialog; rejecting keeps it open with the
   * fields intact and shows `resolveError(caught)` above the footer.
   */
  onSubmit: () => Promise<void>;
  resolveError: (caught: unknown) => string;
  /** The fields. Their value state stays with the caller; only pending/error live here. */
  children: React.ReactNode;
}

/**
 * The shell around every small create/rename form: header, `<form>`, inline error, footer.
 *
 * Callers keep their own field state — that part is genuinely different each time — and hand
 * over only the submit lifecycle, which was identical in all five of them down to the
 * `finally { setPending(false) }`.
 */
export function FormDialog({
  open,
  onOpenChange,
  initialFocusRef,
  ...body
}: FormDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={
          initialFocusRef
            ? (event) => {
                event.preventDefault();
                initialFocusRef.current?.focus();
              }
            : undefined
        }
      >
        {/*
          The pending/error pair lives one level down, inside the content Radix unmounts when
          the dialog closes, so reopening after a failure mounts a fresh pair rather than
          clearing the old one from an effect. Same guarantee, one fewer render, and no
          window in which the reopened dialog is painted still showing the stale reason.
        */}
        <FormDialogBody onOpenChange={onOpenChange} {...body} />
      </DialogContent>
    </Dialog>
  );
}

type FormDialogBodyProps = Omit<FormDialogProps, 'open' | 'initialFocusRef'>;

function FormDialogBody({
  onOpenChange,
  title,
  cancelLabel,
  submitLabel,
  submitDisabled = false,
  onSubmit,
  resolveError,
  children,
}: FormDialogBodyProps): React.ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await onSubmit();
      onOpenChange(false);
    } catch (caught) {
      setError(resolveError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        {children}
        {error ? <SubmitError message={error} /> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button type="submit" disabled={pending || submitDisabled}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
