'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { UserDto } from '@kurul/shared-types';
import { api } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteAccountDialog } from './delete-account-dialog';

/** Row height matches the list/table row in docs/design.md §4, same as `WorkspaceSettings`. */
const ROW = 'flex min-h-9 items-center justify-between gap-3 py-1.5';

/**
 * The account itself, as opposed to the workspace it is currently looking at.
 *
 * One control, and the only one on this screen whose consequences reach past this tenant: it
 * removes the person from every workspace they are in, on every instance-local surface at once
 * (`docs/decisions/0026-account-deletion-anonymisation.md`).
 *
 * The address is read from `/me` rather than from the session, for the same reason
 * `LanguageSettings` reads it from there: Better Auth caches the session user in a cookie for
 * 60 seconds, and the address is what the confirmation gate compares against — a stale one
 * would produce a refusal nobody could explain.
 */
export function AccountSettings(): React.ReactElement {
  const t = useTranslations('app.settings.account');
  const tShell = useTranslations('app.shell');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fetchMe = useCallback((signal: AbortSignal) => api.get<UserDto>('/me', { signal }), []);
  const {
    data: user,
    loading,
    error,
  } = useApiResource<UserDto | null>(fetchMe, null, t('loadError'));

  if (loading) {
    return (
      <div className="flex flex-col gap-2" role="status" aria-busy>
        <span className="sr-only">{tShell('loading')}</span>
        <Skeleton className="h-9 w-full rounded-[var(--radius-md)]" />
      </div>
    );
  }

  // No user means the one read this section needs failed. The delete button is not drawn at
  // all in that state: it would open a dialog that cannot confirm anything, because the
  // address it compares against is exactly what did not load.
  if (!user) {
    return <p className="text-body text-destructive">{error ?? t('loadError')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className={ROW}>
        <p className="min-w-0 truncate text-body text-foreground">{user.email}</p>
      </div>

      <div className={ROW}>
        <div className="min-w-0">
          <p className="text-body text-foreground">{t('deleteSectionTitle')}</p>
          <p className="text-caption text-muted-foreground">{t('deleteSectionBody')}</p>
        </div>
        <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          {t('deleteAction')}
        </Button>
      </div>

      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} email={user.email} />
    </div>
  );
}
