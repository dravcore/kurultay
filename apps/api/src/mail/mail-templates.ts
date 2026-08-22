import { DEFAULT_LOCALE, type Locale } from '@kurul/shared-types';
import type { MailMessage } from './mail-sender';

const PRODUCT_NAME = 'Kurul';

/**
 * Escapes the five characters that can break out of HTML text or an attribute value.
 *
 * Workspace names, display names and URLs are attacker-controllable (anyone can name a
 * workspace), and an invitation email is read in the recipient's mail client — the one place
 * where injected markup is rendered for someone who never chose to trust the sender.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Collapses anything that could split a header (CR, LF) or pad a subject line.
 *
 * nodemailer encodes headers itself, so this is belt-and-braces rather than the only
 * defence — but the value reaching `subject` here comes straight from user input.
 *
 * Applied to the finished subject as well as to the values interpolated into it: a translated
 * subject is a second place a newline could enter, and the header must be single-line in every
 * language, not only in the one the test happened to be written against.
 */
function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Wraps a body in the one shared HTML shell, so both emails look like the same product. */
function htmlDocument(heading: string, bodyHtml: string): string {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.5;color:#111">',
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
    bodyHtml,
    `<p style="font-size:12px;color:#666;margin-top:24px">${escapeHtml(PRODUCT_NAME)}</p>`,
    '</div>',
  ].join('');
}

/** A primary action rendered as a link plus the raw URL, for clients that strip anchors. */
function actionHtml(label: string, url: string, linkFallback: string): string {
  const safeUrl = escapeHtml(url);
  return (
    `<p><a href="${safeUrl}" style="display:inline-block;padding:10px 16px;` +
    `background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>` +
    `<p style="font-size:12px;color:#666">${escapeHtml(linkFallback)}<br>${safeUrl}</p>`
  );
}

/**
 * Every sentence either transactional email puts in front of a person, in one language.
 *
 * Held as data rather than as branches inside the builders for the same reason
 * `SEED_COLUMN_NAMES` is: the structure of an email — which paragraphs it has, in what order,
 * with which link — is not a translator's decision, and a missing sentence should be a
 * compile error rather than a blank paragraph in one language.
 *
 * Interpolation is done with functions, not with `{placeholder}` strings, because word order
 * is exactly what differs between these two languages: Turkish puts the workspace name before
 * the verb and the verb last, so a shared format string would force one of the languages into
 * the other's grammar.
 */
interface MailCopy {
  /** Sentence introducing the raw URL, for clients that strip the button. */
  linkFallback: string;
  verification: {
    subject: string;
    heading: string;
    /** Used when the account has a display name. */
    greeting: (name: string) => string;
    /** Used when it does not — an account can be created without one. */
    greetingAnonymous: string;
    lead: string;
    action: string;
    closing: string;
  };
  invitation: {
    subject: (workspaceName: string) => string;
    heading: (workspaceName: string) => string;
    /** Used when the inviter's display name is known. */
    lead: (inviterName: string, workspaceName: string) => string;
    /** Used when it is not, so the sentence never starts with a blank. */
    leadAnonymous: (workspaceName: string) => string;
    action: string;
    note: string;
    closing: string;
  };
  /**
   * Closes every notification email: why it arrived and where it is switched off. One sentence
   * shared by the three kinds, so the opt-out is described the same way whichever one a person
   * happens to open.
   */
  notificationFooter: string;
  assignment: {
    subject: (title: string) => string;
    heading: string;
    /** Used when the assigning member's display name is known. */
    lead: (actorName: string, title: string, workspaceName: string) => string;
    /** Used when it is not, so the sentence never starts with a blank. */
    leadAnonymous: (title: string, workspaceName: string) => string;
    action: string;
  };
  mention: {
    subject: (title: string) => string;
    heading: string;
    lead: (actorName: string, title: string, workspaceName: string) => string;
    leadAnonymous: (title: string, workspaceName: string) => string;
    action: string;
  };
  dueSoon: {
    subject: (title: string) => string;
    heading: string;
    /** `dueDate` arrives already formatted for the locale; see `formatDueDate`. */
    lead: (title: string, workspaceName: string, dueDate: string) => string;
    action: string;
  };
}

/**
 * The copy tables, keyed by locale.
 *
 * `Record<Locale, …>` deliberately: adding a language to `SUPPORTED_LOCALES` fails to compile
 * here until its email copy exists, so a new locale cannot ship an interface in one language
 * and email in another.
 *
 * On the Turkish register: the domain nouns this product keeps in English throughout its own
 * Turkish documentation (`workspace`, `board`, `task`) are kept in English here too and
 * inflected with an apostrophe (`workspace'ine`). The suffix always attaches to that fixed
 * noun and never to the user-supplied name, so an arbitrary workspace name cannot leave the
 * sentence ungrammatical — a name is quoted and stands beside the noun, never in place of it.
 */
const MAIL_COPY: Record<Locale, MailCopy> = {
  en: {
    linkFallback: 'If the button does not work, paste this link into your browser:',
    verification: {
      subject: `Confirm your email address for ${PRODUCT_NAME}`,
      heading: 'Confirm your email address',
      greeting: (name) => `Hi ${name},`,
      greetingAnonymous: 'Hi,',
      lead: `Confirm this address to finish setting up your ${PRODUCT_NAME} account. You need a confirmed address before you can accept a workspace invitation.`,
      action: 'Confirm email address',
      closing: 'If you did not create this account, you can ignore this email.',
    },
    invitation: {
      subject: (workspaceName) =>
        `You have been invited to join ${workspaceName} on ${PRODUCT_NAME}`,
      heading: (workspaceName) => `Join ${workspaceName}`,
      lead: (inviterName, workspaceName) =>
        `${inviterName} invited you to join the workspace "${workspaceName}" on ${PRODUCT_NAME}.`,
      leadAnonymous: (workspaceName) =>
        `You have been invited to join the workspace "${workspaceName}" on ${PRODUCT_NAME}.`,
      action: 'View invitation',
      // Stated up front because it is the step that will otherwise look like a broken
      // invitation: the accept endpoint refuses an unconfirmed address.
      note: 'Sign in with this email address and confirm it first — an invitation can only be accepted from a confirmed address.',
      closing: 'If you were not expecting this invitation, you can ignore this email.',
    },
    notificationFooter: `You receive this email because notification email is switched on for your ${PRODUCT_NAME} account. You can turn it off under Settings.`,
    assignment: {
      subject: (title) => `You were assigned to "${title}"`,
      heading: 'You have a new assignment',
      lead: (actorName, title, workspaceName) =>
        `${actorName} assigned you to the card "${title}" in the workspace "${workspaceName}".`,
      leadAnonymous: (title, workspaceName) =>
        `You were assigned to the card "${title}" in the workspace "${workspaceName}".`,
      action: 'Open the card',
    },
    mention: {
      subject: (title) => `You were mentioned on "${title}"`,
      heading: 'Someone mentioned you',
      lead: (actorName, title, workspaceName) =>
        `${actorName} mentioned you in a comment on the card "${title}" in the workspace "${workspaceName}".`,
      leadAnonymous: (title, workspaceName) =>
        `You were mentioned in a comment on the card "${title}" in the workspace "${workspaceName}".`,
      action: 'Open the comment',
    },
    dueSoon: {
      subject: (title) => `"${title}" is due soon`,
      heading: 'A card is due soon',
      lead: (title, workspaceName, dueDate) =>
        `The card "${title}" in the workspace "${workspaceName}" is due on ${dueDate}.`,
      action: 'Open the card',
    },
  },
  tr: {
    linkFallback: 'Buton çalışmıyorsa bu bağlantıyı tarayıcınıza yapıştırın:',
    verification: {
      subject: `${PRODUCT_NAME} için e-posta adresinizi doğrulayın`,
      heading: 'E-posta adresinizi doğrulayın',
      greeting: (name) => `Merhaba ${name},`,
      greetingAnonymous: 'Merhaba,',
      lead: `${PRODUCT_NAME} hesabınızı tamamlamak için bu adresi doğrulayın. Bir workspace davetini kabul edebilmeniz için adresinizin doğrulanmış olması gerekiyor.`,
      action: 'E-posta adresini doğrula',
      closing: 'Bu hesabı siz oluşturmadıysanız bu e-postayı yok sayabilirsiniz.',
    },
    invitation: {
      subject: (workspaceName) =>
        `${PRODUCT_NAME}'da ${workspaceName} workspace'ine davet edildiniz`,
      heading: (workspaceName) => `${workspaceName} workspace'ine katılın`,
      lead: (inviterName, workspaceName) =>
        `${inviterName}, sizi ${PRODUCT_NAME}'daki "${workspaceName}" workspace'ine davet etti.`,
      leadAnonymous: (workspaceName) =>
        `${PRODUCT_NAME}'daki "${workspaceName}" workspace'ine davet edildiniz.`,
      action: 'Daveti görüntüle',
      note: 'Önce bu e-posta adresiyle giriş yapın ve adresi doğrulayın — bir davet yalnızca doğrulanmış bir adresten kabul edilebilir.',
      closing: 'Böyle bir davet beklemiyorsanız bu e-postayı yok sayabilirsiniz.',
    },
    notificationFooter: `Bu e-postayı, ${PRODUCT_NAME} hesabınızda bildirim e-postaları açık olduğu için alıyorsunuz. Ayarlar sayfasından kapatabilirsiniz.`,
    assignment: {
      subject: (title) => `"${title}" kartına atandınız`,
      heading: 'Yeni bir atamanız var',
      lead: (actorName, title, workspaceName) =>
        `${actorName}, sizi "${workspaceName}" workspace'indeki "${title}" kartına atadı.`,
      leadAnonymous: (title, workspaceName) =>
        `"${workspaceName}" workspace'indeki "${title}" kartına atandınız.`,
      action: 'Kartı aç',
    },
    mention: {
      subject: (title) => `"${title}" kartında sizden bahsedildi`,
      heading: 'Biri sizden bahsetti',
      lead: (actorName, title, workspaceName) =>
        `${actorName}, "${workspaceName}" workspace'indeki "${title}" kartına yazdığı yorumda sizden bahsetti.`,
      leadAnonymous: (title, workspaceName) =>
        `"${workspaceName}" workspace'indeki "${title}" kartına yazılan bir yorumda sizden bahsedildi.`,
      action: 'Yorumu aç',
    },
    dueSoon: {
      subject: (title) => `"${title}" kartının süresi yaklaşıyor`,
      heading: 'Bir kartın süresi yaklaşıyor',
      lead: (title, workspaceName, dueDate) =>
        `"${workspaceName}" workspace'indeki "${title}" kartının son tarihi ${dueDate}.`,
      action: 'Kartı aç',
    },
  },
};

/** The copy for `locale`, falling back to English rather than throwing on an unknown tag. */
function copyFor(locale: Locale | undefined): MailCopy {
  return MAIL_COPY[locale ?? DEFAULT_LOCALE] ?? MAIL_COPY[DEFAULT_LOCALE];
}

export interface VerificationEmailParams {
  to: string;
  /** The recipient's display name; may be blank for accounts created without one. */
  name: string;
  /** The Better Auth `/auth/verify-email?token=…&callbackURL=…` link. */
  verificationUrl: string;
  /** The recipient's language — see `recipient-locale.ts` for how it is resolved. */
  locale: Locale;
}

export function buildVerificationEmail(params: VerificationEmailParams): MailMessage {
  const copy = copyFor(params.locale).verification;
  const name = singleLine(params.name);
  const greeting = name === '' ? copy.greetingAnonymous : copy.greeting(name);

  return {
    to: params.to,
    subject: singleLine(copy.subject),
    text: [greeting, '', copy.lead, '', params.verificationUrl, '', copy.closing].join('\n'),
    html: htmlDocument(
      copy.heading,
      `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(copy.lead)}</p>` +
        actionHtml(copy.action, params.verificationUrl, copyFor(params.locale).linkFallback) +
        `<p>${escapeHtml(copy.closing)}</p>`,
    ),
  };
}

export interface InvitationEmailParams {
  to: string;
  /** Display name of the member who sent the invitation. */
  inviterName: string;
  workspaceName: string;
  /** The web app's invitation page for this invitation. */
  acceptUrl: string;
  /** The recipient's language — see `recipient-locale.ts` for how it is resolved. */
  locale: Locale;
}

export function buildInvitationEmail(params: InvitationEmailParams): MailMessage {
  const copy = copyFor(params.locale).invitation;
  const workspaceName = singleLine(params.workspaceName);
  const inviterName = singleLine(params.inviterName);
  const lead =
    inviterName === '' ? copy.leadAnonymous(workspaceName) : copy.lead(inviterName, workspaceName);

  return {
    to: params.to,
    subject: singleLine(copy.subject(workspaceName)),
    text: [lead, '', params.acceptUrl, '', copy.note, '', copy.closing].join('\n'),
    html: htmlDocument(
      copy.heading(workspaceName),
      `<p>${escapeHtml(lead)}</p>` +
        actionHtml(copy.action, params.acceptUrl, copyFor(params.locale).linkFallback) +
        `<p>${escapeHtml(copy.note)}</p><p>${escapeHtml(copy.closing)}</p>`,
    ),
  };
}

/**
 * A due date as a person reads it, in their language.
 *
 * `dueDate` is a UTC calendar day (the web formats it with `timeZone: 'UTC'` too), so the
 * email names the day and nothing finer: a time would only be wrong in every zone but one.
 */
function formatDueDate(dueDate: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(dueDate);
}

/** The three notification emails share everything but their copy table and one sentence. */
function notificationEmail(
  params: { to: string; taskUrl: string; locale: Locale },
  copy: { subject: string; heading: string; action: string },
  lead: string,
): MailMessage {
  const shared = copyFor(params.locale);
  return {
    to: params.to,
    subject: singleLine(copy.subject),
    text: [lead, '', params.taskUrl, '', shared.notificationFooter].join('\n'),
    html: htmlDocument(
      copy.heading,
      `<p>${escapeHtml(lead)}</p>` +
        actionHtml(copy.action, params.taskUrl, shared.linkFallback) +
        `<p style="font-size:12px;color:#666">${escapeHtml(shared.notificationFooter)}</p>`,
    ),
  };
}

export interface ActorNotificationEmailParams {
  to: string;
  /** Display name of the member whose action caused the notification; may be blank. */
  actorName: string;
  taskTitle: string;
  workspaceName: string;
  /** The web app's task page, see `buildTaskUrl`. */
  taskUrl: string;
  /** The recipient's stored language; a notification has no request to negotiate from. */
  locale: Locale;
}

export function buildAssignmentEmail(params: ActorNotificationEmailParams): MailMessage {
  const copy = copyFor(params.locale).assignment;
  const title = singleLine(params.taskTitle);
  const workspaceName = singleLine(params.workspaceName);
  const actorName = singleLine(params.actorName);
  const lead =
    actorName === ''
      ? copy.leadAnonymous(title, workspaceName)
      : copy.lead(actorName, title, workspaceName);

  return notificationEmail(params, { ...copy, subject: copy.subject(title) }, lead);
}

export function buildMentionEmail(params: ActorNotificationEmailParams): MailMessage {
  const copy = copyFor(params.locale).mention;
  const title = singleLine(params.taskTitle);
  const workspaceName = singleLine(params.workspaceName);
  const actorName = singleLine(params.actorName);
  const lead =
    actorName === ''
      ? copy.leadAnonymous(title, workspaceName)
      : copy.lead(actorName, title, workspaceName);

  return notificationEmail(params, { ...copy, subject: copy.subject(title) }, lead);
}

export interface DueSoonEmailParams {
  to: string;
  taskTitle: string;
  workspaceName: string;
  dueDate: Date;
  taskUrl: string;
  locale: Locale;
}

export function buildDueSoonEmail(params: DueSoonEmailParams): MailMessage {
  const copy = copyFor(params.locale).dueSoon;
  const title = singleLine(params.taskTitle);
  const workspaceName = singleLine(params.workspaceName);
  const lead = copy.lead(title, workspaceName, formatDueDate(params.dueDate, params.locale));

  return notificationEmail(params, { ...copy, subject: copy.subject(title) }, lead);
}
