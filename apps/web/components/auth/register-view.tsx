'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import { AFTER_REGISTER_PATH, NEXT_PARAM, safeNextPath, withNextParam } from '@/lib/auth-redirect';
import { authClient } from '@/lib/auth';
import { resolveRegisterErrorMapping } from '@/lib/auth-error';

/**
 * The sign-up form.
 *
 * A new account normally goes straight to workspace creation, because the dashboard would
 * have nothing in it. An invitee is the exception: they arrived from an invitation, have a
 * workspace waiting, and `?next=…` is what carries them back to it instead of asking them to
 * create one they do not want.
 *
 * Errors are shown at the field level when the error code maps to a specific field
 * (e.g., `PASSWORD_TOO_SHORT` → password field). Unmapped codes fall back to a generic
 * message shown above the form.
 */
export function RegisterView(): React.ReactElement {
  const t = useTranslations('auth.register');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'email' | 'password', string>>>({});
  const [pending, setPending] = useState(false);

  const next = safeNextPath(searchParams.get(NEXT_PARAM));

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await authClient.signUp.email({
        name,
        email,
        password,
      });

      if (result.error) {
        const mapping = resolveRegisterErrorMapping(result.error.code);

        if (mapping && mapping.field) {
          // Map to a field-level error using the i18n message key.
          const fieldError = t(mapping.messageKey);
          setFieldErrors({ [mapping.field]: fieldError });
        } else {
          // Fall back to generic error for unmapped codes.
          setError(t('error'));
        }
        return;
      }

      router.replace(next ?? AFTER_REGISTER_PATH);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-display tracking-tight">{t('title')}</h1>
        <p className="text-body text-muted-foreground">{t('subtitle')}</p>
      </div>

      <form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
        <AuthFormField
          label={t('name')}
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <AuthFormField
          label={t('email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <AuthFormField
          label={t('password')}
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />
        {error ? <SubmitError message={error} /> : null}
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </form>

      <p className="text-body text-muted-foreground">
        {t('hasAccount')}{' '}
        <Link
          href={withNextParam('/login', next)}
          className="text-signature underline underline-offset-4"
        >
          {t('loginLink')}
        </Link>
      </p>
    </>
  );
}
