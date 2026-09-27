import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api, formValues } from '../api';
import { BRAND } from '@baton/core';
import { Button, ErrorText, Field, Input, Wordmark } from '../ui';

type Step = 'password' | 'verify' | 'setup' | 'forgot' | 'sent';

export function Login() {
  const [step, setStep] = useState<Step>('password');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const nav = useNavigate();
  const qc = useQueryClient();
  const from = (useLocation().state as any)?.from ?? '/';
  const notice = useSearchParams()[0].get('set') ? 'Password saved. Sign in with it now.' : null;

  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['me'] });
    nav(from, { replace: true });
  };
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (step === 'setup' && !qr) api('/auth/mfa/setup', { body: {} }).then(setQr, setError);
  }, [step, qr]);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="canopy relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <Wordmark size={28} dark />
        <div className="mt-auto max-w-lg">
          <h1 className="text-4xl leading-tight font-bold tracking-tight">{BRAND.tagline}</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/65">
            Every query and every hospital bleed gets a ticket, a named owner at each stage and a time stamp at each handover, with a clock that tells you before anything goes red.
          </p>
          <div className="mt-10 flex gap-1.5" aria-hidden>
            {['#5BD0A0', '#5BD0A0', '#5BD0A0', '#FFC53D', '#FFFFFF', '#FFFFFF'].map((c, i) => (
              <span key={i} className={i === 3 ? 'pulse h-2 flex-1 rounded-full' : 'h-2 flex-1 rounded-full'} style={{ background: c, opacity: i > 3 ? 0.3 : 1 }} />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-6 gap-1.5 text-[11px] text-white/60">
            {['Response', 'Bleed', 'Logistics', 'Receiving', 'Processing', 'Reporting'].map((s) => <span key={s}>{s}</span>)}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Wordmark size={26} /></div>

          {step === 'password' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                const v = formValues(e);
                run(async () => {
                  const r = await api('/auth/login', { body: v });
                  if (r.mfa === 'ok') await done();
                  else setStep(r.mfa);
                })();
              }}
            >
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
                <p className="mt-1 text-sm text-muted">Use your network (AD) login or your {BRAND.product} account.</p>
              </div>
              <Field label="E-mail or username"><Input name="username" autoComplete="username" autoFocus required /></Field>
              <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
              {notice && <p className="rounded-lg bg-ok-soft p-2.5 text-sm text-ok" role="status">{notice}</p>}
              <ErrorText error={error} />
              <Button className="w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
              <button type="button" className="w-full text-center text-sm text-muted hover:text-text" onClick={() => { setError(null); setStep('forgot'); }}>Forgot password?</button>
            </form>
          )}

          {step === 'forgot' && (
            <form className="space-y-4" onSubmit={(e) => { const v = formValues(e); run(async () => { await api('/auth/forgot', { body: v }); setStep('sent'); })(); }}>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Reset your password</h2>
                <p className="mt-1 text-sm text-muted">We'll e-mail you a link to choose a new one. Network (AD) passwords are changed in Windows, not here.</p>
              </div>
              <Field label="E-mail"><Input name="email" type="email" autoComplete="email" autoFocus required /></Field>
              <ErrorText error={error} />
              <Button className="w-full" disabled={busy}>Send reset link</Button>
              <button type="button" className="w-full text-center text-sm text-muted hover:text-text" onClick={() => setStep('password')}>Back to sign in</button>
            </form>
          )}

          {step === 'sent' && (
            <div className="space-y-4" role="status">
              <h2 className="text-2xl font-semibold tracking-tight">Check your e-mail</h2>
              <p className="text-sm text-muted">If that address has a {BRAND.product} account, a reset link is on its way. It works once, for 1 hour.</p>
              <Button variant="outline" className="w-full" onClick={() => setStep('password')}>Back to sign in</Button>
            </div>
          )}

          {(step === 'verify' || step === 'setup') && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                const v = formValues(e);
                run(async () => { await api('/auth/mfa/verify', { body: v }); await done(); })();
              }}
            >
              <div className="flex items-center gap-2 text-brand"><ShieldCheck size={20} /><span className="text-sm font-medium">Two-factor verification</span></div>
              {step === 'setup' ? (
                <>
                  <h2 className="text-2xl font-semibold tracking-tight">Set up your authenticator</h2>
                  <p className="text-sm text-muted">Your role requires two-factor sign-in. Scan with Microsoft or Google Authenticator, then enter the 6-digit code.</p>
                  {qr && (
                    <div className="card flex flex-col items-center gap-2 p-4">
                      <img src={qr.qr} alt="Authenticator QR code" width={180} height={180} className="rounded bg-white p-1" />
                      <code className="num text-xs break-all text-muted">{qr.secret}</code>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-semibold tracking-tight">Enter your code</h2>
                  <p className="text-sm text-muted">Open your authenticator app and enter the 6-digit code for {BRAND.product}.</p>
                </>
              )}
              <Field label="Code"><Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,8}" autoFocus required className="num text-lg tracking-[0.3em]" /></Field>
              <ErrorText error={error} />
              <Button className="w-full" disabled={busy}>Verify</Button>
              <button type="button" className="w-full text-center text-sm text-muted hover:text-text" onClick={() => { setStep('password'); setQr(null); }}>Back</button>
            </form>
          )}
          <p className="mt-10 text-center text-xs text-muted">Access is logged and audited. POPIA-protected patient information.</p>
        </div>
      </div>
    </div>
  );
}

/** Opened from an invitation or reset e-mail: choose a password, then sign in (and enrol two-factor where required). */
export function SetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const t = params.get('token') ?? '';
  const [info, setInfo] = useState<{ valid: boolean; purpose?: string; name?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/auth/token/${encodeURIComponent(t)}`).then(setInfo, () => setInfo({ valid: false })); }, [t]);
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <Wordmark size={26} />
        {!info ? <p className="text-sm text-muted">Checking your link…</p> : !info.valid ? (
          <div className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight">This link can't be used</h1>
            <p className="text-sm text-muted">It has expired or was already used. Ask your administrator for a new invitation, or use "Forgot password?" on the sign-in page.</p>
            <Link to="/login" className="text-sm text-brand underline">Go to sign in</Link>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={async (e) => {
            const v = formValues(e);
            setError(null);
            if (v.password !== v.confirm) return setError(new Error('The two passwords do not match'));
            setBusy(true);
            try { await api('/auth/set-password', { body: { token: t, password: v.password } }); nav('/login?set=1', { replace: true }); }
            catch (err) { setError(err); setBusy(false); }
          }}>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{info.purpose === 'invite' ? `Welcome, ${info.name}` : 'Choose a new password'}</h1>
              <p className="mt-1 text-sm text-muted">{info.purpose === 'invite' ? `Choose a password for ${BRAND.product}.` : 'Your other sessions will be signed out.'} At least 10 characters; a short sentence is easiest to remember.</p>
            </div>
            <Field label="New password"><Input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus /></Field>
            <Field label="Repeat it"><Input name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
            <ErrorText error={error} />
            <Button className="w-full" disabled={busy}>Save password</Button>
          </form>
        )}
      </div>
    </div>
  );
}
