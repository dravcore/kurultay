import { getTranslations } from 'next-intl/server';
import { Topbar } from '@/components/layout/topbar';
import { AccountSettings } from '@/components/settings/account-settings';
import { ActivationFunnel } from '@/components/settings/activation-funnel';
import { LanguageSettings } from '@/components/settings/language-settings';
import { MembersSettings } from '@/components/settings/members-settings';
import { NotificationSettings } from '@/components/settings/notification-settings';
import { WorkspaceSettings } from '@/components/settings/workspace-settings';

/**
 * One section of the settings screen: a heading, one sentence about what it decides, and the
 * control that decides it.
 *
 * Extracted the moment there was a second section. The page is a list of these and nothing
 * else, so a new one (workspace name, outbound mail) is a `<SettingsSection>` and its body,
 * not another copy of the heading markup that the next section would drift away from.
 */
function SettingsSection({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-title font-semibold tracking-tight">{title}</h2>
        <p className="text-body text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage(): Promise<React.ReactElement> {
  const t = await getTranslations('app.settings');

  return (
    <>
      <Topbar title={t('title')} />
      {/* 720px: settings are read rather than scanned (docs/design.md §4). */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
          {/* Members first: it is the only section that is about other people, and the one a
              new workspace owner is on this screen to find. */}
          <SettingsSection title={t('members.title')} description={t('members.description')}>
            <MembersSettings />
          </SettingsSection>
          <SettingsSection title={t('language.title')} description={t('language.description')}>
            <LanguageSettings />
          </SettingsSection>
          {/* Next to language: both are about the person rather than the workspace, both are
              set once, and the language section already mentions the email this one controls. */}
          <SettingsSection
            title={t('notifications.title')}
            description={t('notifications.description')}
          >
            <NotificationSettings />
          </SettingsSection>
          {/* Near the end: it holds a control with no undo (delete the workspace), and every
              section above it is either read constantly (members) or set once and forgotten
              (language). Nothing about "workspace" being alphabetically first should put a
              delete button above sections people open every day. */}
          <SettingsSection title={t('workspace.title')} description={t('workspace.description')}>
            <WorkspaceSettings />
          </SettingsSection>
          {/* Last of the tenant sections, and below "delete this workspace" on purpose: this is
              the only control on the screen whose consequences reach past the workspace being
              looked at — it removes the person from every workspace they are in, everywhere on
              this instance (ADR 0026). The ordering rule for this page is "the further down,
              the harder to undo", and nothing is further down than this. */}
          <SettingsSection title={t('account.title')} description={t('account.description')}>
            <AccountSettings />
          </SettingsSection>
          {/* Below the delete button and outside `SettingsSection`, both on purpose. It is the
              only block here that is about the *server* rather than about this workspace, and
              it renders nothing at all for anyone who is not the instance operator — which is
              everyone, until `INSTANCE_ADMIN_EMAILS` says otherwise. A section wrapper would
              draw a heading over that emptiness; see the component's own comment. */}
          <ActivationFunnel />
        </div>
      </div>
    </>
  );
}
