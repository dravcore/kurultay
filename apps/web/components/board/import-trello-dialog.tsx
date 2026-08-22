'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TrelloImportReportDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ImportTrelloDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** Handed the whole `201` body. It is the only copy that will ever exist (ADR 0025). */
  onImported: (report: TrelloImportReportDto) => void;
}

/**
 * Picks a Trello export and posts it.
 *
 * Not built on `FormDialog`, which every other small form here uses, for one reason: the import
 * is synchronous and can run for minutes (ADR 0025 — no queue, no status endpoint), and
 * `FormDialog` always offers a Cancel button. A Cancel that does not cancel is worse than none,
 * because the request keeps running and the board still gets created. So the close affordances
 * are withdrawn for exactly as long as the request is in flight, and the wait says so.
 */
export function ImportTrelloDialog({
  open,
  onOpenChange,
  workspaceId,
  onImported,
}: ImportTrelloDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        The body lives one level down so Radix's unmount on close throws away the picked file,
        the error and the pending flag together — the same reason `FormDialog` splits.
      */}
      <ImportTrelloDialogBody
        onOpenChange={onOpenChange}
        workspaceId={workspaceId}
        onImported={onImported}
      />
    </Dialog>
  );
}

function ImportTrelloDialogBody({
  onOpenChange,
  workspaceId,
  onImported,
}: Omit<ImportTrelloDialogProps, 'open'>): React.ReactElement {
  const t = useTranslations('app.board.import');
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (file === null || pending) return;
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      // No `init`, and above all no headers: `apiFetch` leaves a `FormData` body's Content-Type
      // to the browser, but a header passed by a caller still wins — and the one it would
      // overwrite carries the multipart boundary.
      const report = await api.postForm<TrelloImportReportDto>(
        `/workspaces/${workspaceId}/imports/trello`,
        body,
      );
      onImported(report);
      onOpenChange(false);
    } catch (caught) {
      setError(
        resolveApiMessage(caught, t, {
          fallback: 'error',
          byStatus: { 400: 'badFile', 403: 'forbidden', 413: 'tooLarge', 429: 'tooMany' },
        }),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogContent
      showCloseButton={!pending}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault();
      }}
      onPointerDownOutside={(event) => {
        if (pending) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fileId}>{t('file')}</Label>
          <Input
            id={fileId}
            type="file"
            accept="application/json,.json"
            disabled={pending}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>

        {/*
          Both warnings are above the submit button and neither is dismissible, because both are
          only useful before the click. The duplicate one is the whole user-facing half of "there
          is no idempotency" (ADR 0025): told afterwards, it is an explanation of a mess rather
          than a chance to avoid one.
        */}
        <p className="text-small text-muted-foreground">{t('duplicateWarning')}</p>
        <p className="text-small text-muted-foreground">{t('slowWarning')}</p>

        {error ? <SubmitError message={error} /> : null}
        {pending ? (
          <p className="text-small text-foreground" role="status">
            {t('pending')}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={pending || file === null}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
