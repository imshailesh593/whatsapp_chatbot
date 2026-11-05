import { FormEvent, useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { api } from '../api';
import type { AdminUser } from '../types';

export default function AccountMenu({ user, onSignOut }: { user: AdminUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="inline-flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-full border border-line bg-card text-sm text-fg2 hover:border-line-strong transition whitespace-nowrap"
      >
        <span className="w-6 h-6 rounded-full bg-brand text-on-brand text-[11px] font-bold flex items-center justify-center">
          {user.email.charAt(0).toUpperCase()}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 bg-card border border-line rounded-xl shadow-pop py-1.5 z-50">
          <div className="px-3 pb-2 pt-1 text-xs text-muted border-b border-line mb-1 truncate">{user.email}</div>
          <button
            onClick={() => { setOpen(false); setChanging(true); }}
            className="w-full flex items-center space-x-2.5 px-3 py-2 text-sm text-fg hover:bg-subtle"
          >
            <KeyRound className="w-3.5 h-3.5" /><span>Change password</span>
          </button>
          <button
            onClick={onSignOut}
            className="w-full flex items-center space-x-2.5 px-3 py-2 text-sm text-fg hover:bg-subtle"
          >
            <LogOut className="w-3.5 h-3.5" /><span>Sign out</span>
          </button>
        </div>
      )}

      {changing && <ChangePassword onClose={() => setChanging(false)} />}
    </div>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== again) return setError('The new passwords do not match');
    setBusy(true);
    setError('');
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full bg-sunken border border-line rounded-lg px-3 py-2 text-sm text-fg focus:outline-none focus:border-brand/40';

  return (
    <div className="fixed inset-0 z-50 bg-card/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-sunken border border-line rounded-2xl p-5 shadow-2xl text-left">
        <h3 className="text-base font-bold text-fg mb-4">Change password</h3>
        {done ? (
          <>
            <p className="text-sm text-brand-text">Password updated.</p>
            <button type="button" onClick={onClose} className="mt-4 w-full py-2 bg-subtle hover:bg-subtle rounded-lg text-sm text-fg">Close</button>
          </>
        ) : (
          <>
            <label className="text-xs text-fg2 block mb-1">Current password</label>
            <input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
            <label className="text-xs text-fg2 block mb-1 mt-3">New password (min 10 characters)</label>
            <input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} className={input} />
            <label className="text-xs text-fg2 block mb-1 mt-3">Repeat new password</label>
            <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className={input} />
            {error && <p className="text-xs text-danger mt-3" role="alert">{error}</p>}
            <div className="flex justify-end space-x-2 mt-5">
              <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-muted hover:text-fg">Cancel</button>
              <button disabled={busy} className="px-4 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg disabled:opacity-60">
                {busy ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
