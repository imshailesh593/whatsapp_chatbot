import { FormEvent, useState } from 'react';
import { Bot, CalendarCheck, CheckCircle2, Languages, MessagesSquare } from 'lucide-react';
import { api } from '../api';
import type { AdminUser } from '../types';
import { useProduct } from '../brand';
import Logo from './Logo';
import { ThemeToggle } from './ui';

const POINTS = [
  { icon: <MessagesSquare className="w-4 h-4" />, text: 'Answers every WhatsApp enquiry instantly, day and night' },
  { icon: <Bot className="w-4 h-4" />, text: 'Asks your questions and qualifies each lead with AI' },
  { icon: <CalendarCheck className="w-4 h-4" />, text: 'Books appointments and confirms them on WhatsApp' },
  { icon: <Languages className="w-4 h-4" />, text: 'Chats in English, Hindi, Hinglish, Tamil and Malayalam' }
];

export default function Login({ onDone }: { onDone: (user: AdminUser) => void }) {
  const product = useProduct();
  // A referral link (/admin/?ref=CODE) opens the sign-up form and remembers the code
  const ref = (() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('ref');
      if (fromUrl) sessionStorage.setItem('lk_ref', fromUrl);
      return sessionStorage.getItem('lk_ref') ?? '';
    } catch {
      return '';
    }
  })();
  // "Get started" on the website (/admin/?plan=pro): open the sign-up form, and after signing in show the payment page
  const wantsPlan = (() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const want = q.has('plan') || q.get('signup') === '1';
      if (want) sessionStorage.setItem('lk_checkout', '1');
      return want;
    } catch {
      return false;
    }
  })();
  const [mode, setMode] = useState<'signin' | 'signup'>(ref || wantsPlan ? 'signup' : 'signin');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup' && (product.signupEnabled || !!ref);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = signup ? await api.signup(businessName, email, password, ref || undefined) : await api.login(email, password);
      onDone(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full bg-card border border-line-strong rounded-lg px-3.5 py-2.5 text-sm text-fg placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand/15 transition';
  const label = 'text-sm font-medium text-fg2 block mb-1.5';

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-app">
      <aside className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 text-white bg-gradient-to-br from-emerald-700 via-emerald-800 to-slate-900">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full bg-teal-300/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <Logo size={40} className="ring-2 ring-white/20" />
          <span className="text-xl font-semibold tracking-tight">{product.productName}</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-semibold tracking-tight leading-tight">Turn WhatsApp chats into customers.</h2>
          <p className="mt-4 text-emerald-100/90 leading-relaxed">Capture leads, answer questions, book appointments and follow up, all from one calm dashboard.</p>
          <ul className="mt-8 space-y-3.5">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-start gap-3 text-sm text-emerald-50">
                <span className="mt-0.5 w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0">{p.icon}</span>
                <span className="pt-1">{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-emerald-100/70 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Your customers&apos; data stays yours. See our <a className="underline" href="/privacy">privacy policy</a>.</p>
      </aside>

      <main className="relative flex items-center justify-center p-6 sm:p-10">
        <div className="absolute top-4 right-4"><ThemeToggle /></div>
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8"><Logo size={40} /><span className="text-xl font-semibold tracking-tight">{product.productName}</span></div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="text-sm text-muted mt-1.5 mb-7">{signup ? 'Set up your WhatsApp bot in about ten minutes.' : 'Sign in to your dashboard.'}</p>

          {signup && (
            <div className="mb-4">
              <label className={label} htmlFor="biz">Business name</label>
              <input id="biz" required maxLength={80} value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={input} placeholder="Acme Dental Clinic" />
            </div>
          )}

          <div className="mb-4">
            <label className={label} htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" autoFocus={!signup} required value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="you@example.com" />
          </div>

          <div>
            <label className={label} htmlFor="password">Password{signup ? ' (min 10 characters)' : ''}</label>
            <input id="password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
          </div>

          {error && <p className="text-sm text-danger bg-danger-soft border border-danger-line rounded-lg px-3 py-2 mt-4" role="alert">{error}</p>}
          <button
            disabled={busy || !email || !password || (signup && !businessName.trim())}
            className="w-full mt-6 py-3 bg-brand hover:bg-brand-strong text-on-brand font-semibold text-sm rounded-lg shadow-card transition disabled:opacity-50"
          >
            {busy ? (signup ? 'Creating…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
          </button>

          {product.signupEnabled && (
            <p className="text-sm text-muted mt-5 text-center">
              {signup ? 'Already have an account?' : 'New here?'}{' '}
              <button type="button" className="text-brand-text hover:underline font-semibold" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(''); }}>
                {signup ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          )}
          {!signup && <p className="text-xs text-muted mt-4 text-center">Forgot your password? Ask your account owner to reset it.</p>}
          {signup && (
            <p className="text-xs text-muted mt-4 text-center leading-relaxed">
              By creating an account you agree to the <a className="underline hover:text-fg" href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>, the <a className="underline hover:text-fg" href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and the <a className="underline hover:text-fg" href="/refunds" target="_blank" rel="noopener noreferrer">Refund Policy</a>.
            </p>
          )}
          <p className="text-xs text-muted mt-8 text-center">
            <a className="hover:text-fg" href="/">Home</a> · <a className="hover:text-fg" href="/privacy">Privacy</a> · <a className="hover:text-fg" href="/terms">Terms</a> · <a className="hover:text-fg" href="/refunds">Refunds</a> · <a className="hover:text-fg" href="/contact">Contact</a>
          </p>
        </form>
      </main>
    </div>
  );
}
