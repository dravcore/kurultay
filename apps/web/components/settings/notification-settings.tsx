'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { UpdateMeRequest, UserDto } from '@kurul/shared-types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api, resolveApiMessage } from '@/lib/api';
import { useApiResource } from '@/lib/use-api-resource';

/**
 * The per-user switch for notification email: assignments, mentions and due-soon reminders.
 *
 * One checkbox for every kind, because the field behind it is one boolean (`UserDto.
 * emailNotifications`); a per-kind list would promise a granularity the API does not have.
 * The stored value is the source of truth and is re-read from the response, so two tabs on
 * this screen cannot disagree after a save.
 */
export function NotificationSettings(): React.ReactElement {
  const t = useTranslations('app.settings.notifications');
  const tErrors = useTranslations('app.errors');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<boolean | null>(null);

  const fetchMe = useCallback((signal: AbortSignal) => api.get<UserDto>('/me', { signal }), []);
  const {
    data: user,
    loading,
    error,
    reload,
  } = useApiResource<UserDto | null>(fetchMe, null, t('loadError'));

  const onChange = useCallback(
    async (emailNotifications: boolean): Promise<void> => {
      setSaving(true);
      try {
        const body: UpdateMeRequest = { emailNotifications };
        const updated = await api.patch<UserDto, UpdateMeRequest>('/me', body);
        setSaved(updated.emailNotifications);
        toast.success(t('saved'));
      } catch (caught) {
        toast.error(
          resolveApiMessage(caught, t, {
            fallback: 'saveError',
            byStatus: { 401: 'saveErrorSignedOut' },
          }),
        );
      } finally {
        setSaving(false);
      }
    },
    [t],
  );

  if (loading) {
    return <Skeleton className="h-9 w-full max-w-xs" />;
  }

  if (error !== null || !user) {
    // Unexplained, so the recovery is a control rather than a sentence (docs/design.md §7).
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-body text-destructive">{error ?? t('loadError')}</p>
        <Button type="button" onClick={reload}>
          {tErrors('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-body max-md:min-h-11">
        <input
          type="checkbox"
          className="size-4 rounded border-input"
          checked={saved ?? user.emailNotifications}
          disabled={saving}
          onChange={(event) => void onChange(event.target.checked)}
        />
        <span>{t('emailLabel')}</span>
      </label>
      <p className="text-caption text-muted-foreground">{t('help')}</p>
    </div>
  );
}
