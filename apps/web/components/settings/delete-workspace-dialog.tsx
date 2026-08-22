'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { WorkspaceDto } from '@kurul/shared-types';
import { api, resolveApiMessage } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { disconnectSocket } from '@/lib/socket';
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

interface DeleteWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceDto;
}

/**
 * Delete the workspace outright — the one control on this screen nothing can undo.
 *
 * `ConfirmDialog` (used everywhere else destructive on this screen) is deliberately not reused
 * here. Board, column, task, and member removal all recover from a stray click by the actual
 * cost of the mistake — a demoted admin gets re-promoted, a removed member gets re-invited.
 * Deleting the workspace does not: `WorkspaceService.remove` calls Better Auth's
 * `deleteOrganization`, and the FK cascades on `workspaceId` (audit finding DB-06,
 * `audit/findings/database.md`) take every board, column, task, and comment with it in the same
 * statement — there is no soft-delete staging period and no automated backup to fall back on
 * (DB-01). A single "Delete workspace?" confirm click is not a proportionate gate for that; the
 * caller has to type the workspace's exact name before the button will even accept a click,
 * the same friction GitHub and similar tools put in front of an unrecoverable delete.
 *
 * Unlike `RemoveMemberDialog`, `RevokeInvitationDialog`, and `ChangeMemberRoleDialog`, this
 * dialog does not report an outcome back to a list — there is no roster row for "the workspace
 * that no longer exists" to disappear from. It owns its own aftermath instead, the same way
 * `LeaveWorkspaceDialog` does and for the same reason: `setActive(null)` clears Better Auth's
 * session store (what the shell bootstraps from) so the client stops asking a workspace that is
 * gone for anything, and `disconnectSocket()` drops a socket still authenticated to rooms the
 * server has already torn down. Deleting is leaving with extra consequences for everyone else
 * who was in it, not a different kind of exit for the caller who just did it.
 */
export function DeleteWorkspaceDialog({
  open,
  onOpenChange,
  workspace,
}: DeleteWorkspaceDialogProps): React.ReactElement {
  const t = useTranslations('app.settings.workspace');
  const router = useRouter();
  const [typedName, setTypedName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmed = typedName === workspace.name;

  async function onConfirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await api.delete(`/workspaces/${workspace.id}`);

      disconnectSocket();
      await authClient.organization.setActive({ organizationId: null });

      // The destination (the dashboard, possibly for a different workspace entirely) says
      // nothing about what just happened, so this is the "off-screen effect" case design.md
      // §7 asks for a message on — the same reasoning `LeaveWorkspaceDialog` follows.
      toast.success(t('deleteDone', { name: workspace.name }));
      onOpenChange(false);
      router.replace('/dashboard');
      router.refresh();
    } catch (caught) {
      setError(
        resolveApiMessage(caught, t, {
          fallback: 'deleteError',
          byStatus: { 403: 'deleteErrorForbidden', 404: 'deleteErrorGone' },
        }),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteBody', { name: workspace.name })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delete-workspace-confirm">
            {t('deleteConfirmLabel', { name: workspace.name })}
          </Label>
          <Input
            id="delete-workspace-confirm"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            autoComplete="off"
            aria-invalid={typedName.length > 0 && !confirmed}
          />
        </div>
        {error ? <SubmitError message={error} /> : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || !confirmed}
            onClick={() => void onConfirm()}
          >
            {t('deleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
