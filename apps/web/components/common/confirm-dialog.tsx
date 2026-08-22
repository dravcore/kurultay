'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SubmitError } from '@/components/common/submit-error';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** Renders the confirm button in the destructive variant. */
  destructive?: boolean;
  /** Blocks the action while `description` still explains why (a column that has tasks). */
  confirmDisabled?: boolean;
  /**
   * Runs the action. Resolving closes the dialog; rejecting keeps it open and shows
   * `resolveError(caught)` above the footer, which is where the 403/409 wording belongs.
   */
  onConfirm: () => Promise<void>;
  resolveError: (caught: unknown) => string;
}

/**
 * The confirm-or-cancel half of every destructive flow: title, reason, the two buttons, and
 * the pending/error bookkeeping that sits between them.
 *
 * Owning `pending` and `error` here is the point — each caller previously carried its own
 * pair of `useState`s plus the `finally { setPending(false) }` that is easy to drop on the
 * error path, leaving a dialog stuck behind a disabled button.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  ...body
}: ConfirmDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/*
          The pending/error pair lives one level down, inside the content Radix unmounts when
          the dialog closes, so reopening after a failure mounts a fresh pair rather than
          clearing the old one from an effect. Same guarantee, one fewer render, and no
          window in which the reopened dialog is painted still showing the stale reason.
        */}
        <ConfirmDialogBody onOpenChange={onOpenChange} {...body} />
      </DialogContent>
    </Dialog>
  );
}

type ConfirmDialogBodyProps = Omit<ConfirmDialogProps, 'open'>;

function ConfirmDialogBody({
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  resolveError,
}: ConfirmDialogBodyProps): React.ReactElement {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
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
        {description ? <DialogDescription>{description}</DialogDescription> : null}
      </DialogHeader>
      {error ? <SubmitError message={error} /> : null}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          variant={destructive ? 'destructive' : 'default'}
          disabled={pending || confirmDisabled}
          onClick={() => void confirm()}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
