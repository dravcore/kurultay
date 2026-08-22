import { SUPPORTED_LOCALES, type Locale } from '@kurul/shared-types';
import {
  buildAssignmentEmail,
  buildDueSoonEmail,
  buildInvitationEmail,
  buildMentionEmail,
  buildVerificationEmail,
} from './mail-templates';

describe('buildVerificationEmail', () => {
  const params = {
    to: 'new-user@example.test',
    name: 'Ada Lovelace',
    verificationUrl: 'http://localhost:4000/auth/verify-email?token=jwt&callbackURL=x',
    locale: 'en' as Locale,
  };

  it('addresses the recipient and carries the verification link in both bodies', () => {
    const message = buildVerificationEmail(params);

    expect(message.to).toBe('new-user@example.test');
    expect(message.subject).toContain('Kurul');
    expect(message.text).toContain('Ada Lovelace');
    expect(message.text).toContain(params.verificationUrl);
    // `&` is escaped in the attribute — that is correct HTML, and mail clients decode it.
    expect(message.html).toContain(
      'href="http://localhost:4000/auth/verify-email?token=jwt&amp;callbackURL=x"',
    );
  });

  it('greets a nameless account without a dangling blank', () => {
    const message = buildVerificationEmail({ ...params, name: '   ' });

    expect(message.text.startsWith('Hi,')).toBe(true);
  });

  it('writes the whole email in Turkish for a Turkish recipient', () => {
    const message = buildVerificationEmail({ ...params, locale: 'tr' });

    expect(message.subject).toContain('doğrulayın');
    expect(message.text.startsWith('Merhaba Ada Lovelace,')).toBe(true);
    // The link survives translation — it is the only part of the email that has to.
    expect(message.text).toContain(params.verificationUrl);
    expect(message.html).toContain('E-posta adresini doğrula');
    // Nothing from the English copy leaks into the Turkish body.
    expect(message.text).not.toContain('Confirm this address');
  });

  it('greets a nameless Turkish account without a dangling blank', () => {
    const message = buildVerificationEmail({ ...params, name: '   ', locale: 'tr' });

    expect(message.text.startsWith('Merhaba,')).toBe(true);
  });
});

describe('buildInvitationEmail', () => {
  const params = {
    to: 'invitee@example.test',
    inviterName: 'Ada Lovelace',
    workspaceName: 'Analytical Engine',
    acceptUrl: 'http://localhost:3000/invite/0199f0d2-0000-7000-8000-000000000001',
    locale: 'en' as Locale,
  };

  it('names the workspace and the inviter, and links to the invitation page', () => {
    const message = buildInvitationEmail(params);

    expect(message.to).toBe('invitee@example.test');
    expect(message.subject).toContain('Analytical Engine');
    expect(message.text).toContain('Ada Lovelace');
    expect(message.text).toContain(params.acceptUrl);
    expect(message.html).toContain(`href="${params.acceptUrl}"`);
  });

  it('tells the invitee that the address has to be confirmed first', () => {
    const message = buildInvitationEmail(params);

    expect(message.text).toContain('confirm');
  });

  it('escapes markup in the workspace name, which anyone can choose', () => {
    const message = buildInvitationEmail({
      ...params,
      workspaceName: '<img src=x onerror="alert(1)">',
    });

    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&lt;img');
  });

  it('keeps a multi-line workspace name out of the subject header', () => {
    const message = buildInvitationEmail({
      ...params,
      workspaceName: 'Engine\r\nBcc: attacker@example.test',
    });

    expect(message.subject).not.toMatch(/[\r\n]/);
  });

  it('writes the whole email in Turkish, still naming the workspace and the inviter', () => {
    const message = buildInvitationEmail({ ...params, locale: 'tr' });

    expect(message.subject).toContain('Analytical Engine');
    expect(message.subject).toContain('davet edildiniz');
    expect(message.text).toContain('Ada Lovelace');
    expect(message.text).toContain(params.acceptUrl);
    expect(message.text).toContain('doğrulanmış');
    expect(message.text).not.toContain('invited you to join');
  });

  it('states the Turkish confirm-first note the accept endpoint enforces', () => {
    // The Turkish half of "tells the invitee that the address has to be confirmed first". The
    // note is the difference between an invitation that looks broken and one that explains
    // itself, and it has to survive translation in both languages, not only in English.
    const message = buildInvitationEmail({ ...params, locale: 'tr' });

    expect(message.text).toContain('doğrula');
  });

  it('drops the inviter cleanly in Turkish when the display name is blank', () => {
    const message = buildInvitationEmail({ ...params, inviterName: '  ', locale: 'tr' });

    expect(message.text.startsWith('Kurul')).toBe(true);
    expect(message.text).toContain('davet edildiniz');
  });
});

describe('notification emails', () => {
  const params = {
    to: 'member@example.test',
    actorName: 'Ada Lovelace',
    taskTitle: 'Ship the release',
    workspaceName: 'Analytical Engine',
    taskUrl: 'http://localhost:3000/board/b1/task/0199f0d2-0000-7000-8000-000000000001',
    locale: 'en' as Locale,
  };

  describe('buildAssignmentEmail', () => {
    it('names the actor, the card and the workspace, and links to the card', () => {
      const message = buildAssignmentEmail(params);

      expect(message.to).toBe('member@example.test');
      expect(message.subject).toContain('Ship the release');
      expect(message.text).toContain('Ada Lovelace');
      expect(message.text).toContain('Analytical Engine');
      expect(message.text).toContain(params.taskUrl);
      expect(message.html).toContain(`href="${params.taskUrl}"`);
    });

    it('says where the email can be switched off', () => {
      const message = buildAssignmentEmail(params);

      expect(message.text).toContain('turn it off');
    });

    it('drops the actor cleanly when the display name is blank', () => {
      const message = buildAssignmentEmail({ ...params, actorName: '  ' });

      expect(message.text.startsWith('You were assigned')).toBe(true);
    });

    it('writes the whole email in Turkish', () => {
      const message = buildAssignmentEmail({ ...params, locale: 'tr' });

      expect(message.subject).toContain('atandınız');
      expect(message.text).toContain('Ada Lovelace');
      expect(message.text).toContain(params.taskUrl);
      expect(message.text).toContain('kapatabilirsiniz');
      expect(message.text).not.toContain('assigned you');
    });
  });

  describe('buildMentionEmail', () => {
    it('names the actor and the card, and links to the card', () => {
      const message = buildMentionEmail(params);

      expect(message.subject).toContain('mentioned');
      expect(message.text).toContain('Ada Lovelace');
      expect(message.text).toContain('Ship the release');
      expect(message.text).toContain(params.taskUrl);
    });

    it('writes the whole email in Turkish', () => {
      const message = buildMentionEmail({ ...params, locale: 'tr' });

      expect(message.subject).toContain('bahsedildi');
      expect(message.text).not.toContain('mentioned you');
    });
  });

  describe('buildDueSoonEmail', () => {
    const dueSoon = {
      to: params.to,
      taskTitle: params.taskTitle,
      workspaceName: params.workspaceName,
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      taskUrl: params.taskUrl,
      locale: 'en' as Locale,
    };

    it("names the card and spells the due day in the recipient's language", () => {
      const message = buildDueSoonEmail(dueSoon);

      expect(message.subject).toContain('due soon');
      expect(message.text).toContain('September 1, 2026');
      expect(message.text).toContain(params.taskUrl);
    });

    it('formats the day for a Turkish recipient', () => {
      const message = buildDueSoonEmail({ ...dueSoon, locale: 'tr' });

      expect(message.subject).toContain('yaklaşıyor');
      expect(message.text).toContain('1 Eylül 2026');
    });

    it('reads the day in UTC, which is how the web shows it', () => {
      // 23:30 UTC on the 1st is the 2nd in half the world; the email and the card must agree.
      const message = buildDueSoonEmail({
        ...dueSoon,
        dueDate: new Date('2026-09-01T23:30:00.000Z'),
      });

      expect(message.text).toContain('September 1, 2026');
    });
  });
});

describe('every supported locale', () => {
  const invitation = {
    to: 'invitee@example.test',
    inviterName: 'Ada Lovelace',
    workspaceName: 'Analytical Engine',
    acceptUrl: 'http://localhost:3000/invite/0199f0d2-0000-7000-8000-000000000001',
  };
  const verification = {
    to: 'new-user@example.test',
    name: 'Ada Lovelace',
    verificationUrl: 'http://localhost:4000/auth/verify-email?token=jwt&callbackURL=x',
  };

  describe.each(SUPPORTED_LOCALES)('locale %s', (locale) => {
    it('keeps a header-splitting workspace name out of the subject', () => {
      // The existing English case, run against every language: a subject is a header in all of
      // them, and a translated subject is a second place a newline could enter.
      const message = buildInvitationEmail({
        ...invitation,
        workspaceName: 'Engine\r\nBcc: attacker@example.test',
        locale,
      });

      expect(message.subject).not.toMatch(/[\r\n]/);
    });

    it('writes a single-line subject on both emails', () => {
      expect(buildInvitationEmail({ ...invitation, locale }).subject).not.toMatch(/[\r\n]/);
      expect(buildVerificationEmail({ ...verification, locale }).subject).not.toMatch(/[\r\n]/);
    });

    it('escapes a markup-carrying workspace name', () => {
      const message = buildInvitationEmail({
        ...invitation,
        workspaceName: '<img src=x onerror="alert(1)">',
        locale,
      });

      expect(message.html).not.toContain('<img');
    });

    it('carries the action link in the text body of both emails', () => {
      // A translation that loses the URL leaves the recipient with a sentence and no way to
      // act on it — the one failure that makes the email worthless rather than merely awkward.
      expect(buildInvitationEmail({ ...invitation, locale }).text).toContain(invitation.acceptUrl);
      expect(buildVerificationEmail({ ...verification, locale }).text).toContain(
        verification.verificationUrl,
      );
    });

    it('leaves no blank line where a sentence should be', () => {
      const message = buildInvitationEmail({ ...invitation, locale });

      for (const line of message.text.split('\n')) {
        expect(line).not.toMatch(/^\s+$/);
      }
    });

    it('keeps a header-splitting card title out of every notification subject', () => {
      const notification = {
        to: 'member@example.test',
        actorName: 'Ada',
        taskTitle: 'Card\r\nBcc: attacker@example.test',
        workspaceName: 'Analytical Engine',
        taskUrl: 'http://localhost:3000/board/b1/task/t1',
        locale,
      };

      expect(buildAssignmentEmail(notification).subject).not.toMatch(/[\r\n]/);
      expect(buildMentionEmail(notification).subject).not.toMatch(/[\r\n]/);
      expect(
        buildDueSoonEmail({ ...notification, dueDate: new Date('2026-09-01T00:00:00Z') }).subject,
      ).not.toMatch(/[\r\n]/);
    });

    it('escapes a markup-carrying card title in every notification email', () => {
      const notification = {
        to: 'member@example.test',
        actorName: '<b>Ada</b>',
        taskTitle: '<img src=x onerror="alert(1)">',
        workspaceName: 'Analytical Engine',
        taskUrl: 'http://localhost:3000/board/b1/task/t1',
        locale,
      };

      expect(buildAssignmentEmail(notification).html).not.toContain('<img');
      expect(buildAssignmentEmail(notification).html).not.toContain('<b>');
      expect(buildMentionEmail(notification).html).not.toContain('<img');
      expect(
        buildDueSoonEmail({ ...notification, dueDate: new Date('2026-09-01T00:00:00Z') }).html,
      ).not.toContain('<img');
    });
  });
});
