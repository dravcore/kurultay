'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { AuthFormField } from '@/components/auth/auth-form-field';
import { SubmitError } from '@/components/common/submit-error';
import { Button } from '@/components/ui/button';
import { AFTER_LOGIN_PATH, NEXT_PARAM, safeNextPath, withNextParam } from '@/lib/auth-redirect';
import { authClient } from '@/lib/auth';

/**
 * The sign-in form.
 *
 * Most visitors arrive here because something sent them: the middleware bouncing them off a
 * protected route, or an invitation link they cannot accept signed out. Those callers write
 * where the visitor was going into `?next=…`, and signing in has to hand them back to it —
 * an invitee dropped on the dashboard instead has to go find the invitation email again.
 */
export function LoginView(): React.ReactElement {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Validated here rather than at the redirect, so the sign-up link below carries only a
  // destination this page would itself honour.
  const next = safeNextPath(searchParams.get(NEXT_PARAM));

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(t('error'));
        return;
      }

      router.replace(next ?? AFTER_LOGIN_PATH);
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
          label={t('email')}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthFormField
          label={t('password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <SubmitError message={error} /> : null}
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </form>

      <p className="text-body text-muted-foreground">
        {t('noAccount')}{' '}
        {/* An invitee without an account crosses to sign-up here; the destination has to
            cross with them or the detour loses the invitation. */}
        <Link
          href={withNextParam('/register', next)}
          className="text-signature underline underline-offset-4"
        >
          {t('registerLink')}
        </Link>
      </p>
    </>
  );
}
