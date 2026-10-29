import { FormEvent, useState } from 'react';
import { Globe } from 'lucide-react';
import { api } from '../api';
import type { AdminUser } from '../types';
import { useProduct } from '../brand';

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
  const [mode, setMode] = useState<'signin' | 'signup'>(ref ? 'signup' : 'signin');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

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

  const input =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center">
            <Globe className="w-5 h-5 text-slate-950" />
          </div>
          <div>
            <div className="font-extrabold text-white">{product.productName}</div>
            <div className="text-[11px] text-slate-400">{signup ? 'Create your account and set up your WhatsApp bot' : 'WhatsApp lead console'}</div>
          </div>
        </div>

        {signup && (
          <>
            <label className="text-xs font-medium text-slate-300 block mb-1" htmlFor="biz">Business name</label>
            <input id="biz" required maxLength={80} value={businessName} onChange={(e) => setBusinessName(e.target.value)} className={input} placeholder="Acme Dental Clinic" />
          </>
        )}

        <label className={`text-xs font-medium text-slate-300 block mb-1 ${signup ? 'mt-4' : ''}`} htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          autoFocus={!signup}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
          placeholder="you@example.com"
        />

        <label className="text-xs font-medium text-slate-300 block mb-1 mt-4" htmlFor="password">Password{signup ? ' (min 10 characters)' : ''}</label>
        <input
          id="password"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          required
          minLength={signup ? 10 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
        />

        {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
        <button
          disabled={busy || !email || !password || (signup && !businessName.trim())}
          className="w-full mt-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-lg transition disabled:opacity-50"
        >
          {busy ? (signup ? 'Creating…' : 'Signing in…') : signup ? 'Create account' : 'Sign in'}
        </button>

        {product.signupEnabled && (
          <p className="text-xs text-slate-400 mt-4 text-center">
            {signup ? 'Already have an account?' : 'New here?'}{' '}
            <button type="button" className="text-emerald-400 hover:text-emerald-300 font-semibold" onClick={() => { setMode(signup ? 'signin' : 'signup'); setError(''); }}>
              {signup ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        )}
        {!signup && <p className="text-[11px] text-slate-500 mt-3 text-center">Forgot your password? Ask your account owner to reset it.</p>}
        {signup && (
          <p className="text-[11px] text-slate-500 mt-3 text-center">
            By creating an account you agree to the <a className="underline hover:text-slate-300" href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>, the <a className="underline hover:text-slate-300" href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> and the <a className="underline hover:text-slate-300" href="/refunds" target="_blank" rel="noopener noreferrer">Refund Policy</a>.
          </p>
        )}
        <p className="text-[11px] text-slate-600 mt-4 text-center">
          <a className="hover:text-slate-300" href="/">Home</a> · <a className="hover:text-slate-300" href="/privacy">Privacy</a> · <a className="hover:text-slate-300" href="/terms">Terms</a> · <a className="hover:text-slate-300" href="/refunds">Refunds</a> · <a className="hover:text-slate-300" href="/contact">Contact</a>
        </p>
      </form>
    </div>
  );
}
