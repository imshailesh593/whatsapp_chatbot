import { useCallback, useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { api } from '../api';
import type { AdminUser, CalendarInfo } from '../types';

const card = 'bg-slate-950 border border-slate-800 rounded-2xl p-5 shadow-lg';
const input = 'bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function Appointments({ me }: { me: AdminUser }) {
  const [info, setInfo] = useState<CalendarInfo | null>(null);
  const [form, setForm] = useState<CalendarInfo['settings']>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit = me.role === 'owner' || me.role === 'admin';

  const load = useCallback(
    () =>
      api.calendar().then((c) => {
        setInfo(c);
        setForm(c.settings);
      }).catch((e) => setError((e as Error).message)),
    []
  );
  useEffect(() => { load(); }, [load]);

  // Google sends the owner back to /admin/?calendar=connected
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('calendar');
    if (!q) return;
    if (q === 'connected') setNote('Google Calendar connected.');
    else setError('Google Calendar could not be connected. Please try again.');
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []);

  async function run(fn: () => Promise<unknown>, done = '') {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await fn();
      if (done) setNote(done);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError('');
    try {
      window.location.href = (await api.calendarConnect()).url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (!info) return <div className={card + ' text-xs text-slate-500'}>{error || 'Loading appointments…'}</div>;
  const set = (k: string, v: number | string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const toggleDay = (n: number) => setForm((f) => f && { ...f, workDays: f.workDays.includes(n) ? f.workDays.filter((d) => d !== n) : [...f.workDays, n].sort() });

  return (
    <div className={card}>
      <h3 className="font-bold text-white text-base flex items-center space-x-2"><CalendarDays className="w-4 h-4 text-emerald-400" /><span>Appointments (Google Calendar)</span></h3>
      <p className="text-[11px] text-slate-500 mt-1">
        Connect your Google Calendar and the bot offers real free times to customers who have finished the questions, books the one they choose, adds it to your calendar and reminds them. Times use your business time zone ({info.timezone}).
      </p>

      {!info.connected && (
        <div className="mt-4">
          {info.googleAvailable ? (
            canEdit && <button onClick={connect} disabled={busy} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-50">Connect Google Calendar</button>
          ) : (
            <p className="text-[11px] text-amber-400">Google sign-in is not set up on this server yet. The platform operator needs to add the Google keys first.</p>
          )}
        </div>
      )}

      {info.connected && form && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded-full border bg-emerald-500/15 text-emerald-300 border-emerald-500/40 font-semibold">Connected{info.email ? ` · ${info.email}` : ''}</span>
            {canEdit && <button onClick={() => window.confirm('Disconnect Google Calendar? The bot will stop offering times. Existing appointments stay in your calendar.') && run(() => api.calendarDisconnect(), 'Disconnected.')} className="text-slate-400 hover:text-rose-300 underline">Disconnect</button>}
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-slate-400">
            <label>Appointment length (min)<input type="number" min={10} max={240} step={5} value={form.slotMinutes} disabled={!canEdit} onChange={(e) => set('slotMinutes', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Break between (min)<input type="number" min={0} max={120} step={5} value={form.bufferMinutes} disabled={!canEdit} onChange={(e) => set('bufferMinutes', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Opens<input type="time" value={form.workStart} disabled={!canEdit} onChange={(e) => set('workStart', e.target.value)} className={input + ' block mt-1 w-full'} /></label>
            <label>Closes<input type="time" value={form.workEnd} disabled={!canEdit} onChange={(e) => set('workEnd', e.target.value)} className={input + ' block mt-1 w-full'} /></label>
            <label>Minimum notice (hours)<input type="number" min={0} max={168} value={form.noticeHours} disabled={!canEdit} onChange={(e) => set('noticeHours', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Book up to (days ahead)<input type="number" min={1} max={60} value={form.daysAhead} disabled={!canEdit} onChange={(e) => set('daysAhead', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Remind customer (hours before, 0 = off)<input type="number" min={0} max={48} value={form.reminderHours} disabled={!canEdit} onChange={(e) => set('reminderHours', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span>Working days:</span>
            {DAYS.map((d, i) => (
              <button key={d} type="button" disabled={!canEdit} onClick={() => toggleDay(i + 1)}
                className={`px-2.5 py-1 rounded-lg border ${form.workDays.includes(i + 1) ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>{d}</button>
            ))}
          </div>
          {canEdit && <button onClick={() => run(() => api.calendarSave(form), 'Saved.')} disabled={busy} className="mt-4 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg disabled:opacity-50">Save</button>}

          <h4 className="mt-6 text-xs font-bold uppercase tracking-wider text-slate-400">Upcoming appointments</h4>
          {info.appointments.length === 0 ? (
            <p className="text-[11px] text-slate-500 mt-2">None yet. Customers book by messaging &ldquo;book an appointment&rdquo; after they finish the questions.</p>
          ) : (
            <div className="mt-2 divide-y divide-slate-800/70 border border-slate-800 rounded-xl overflow-hidden text-xs">
              {info.appointments.map((a) => (
                <div key={a.id} className={`flex items-center justify-between px-3.5 py-2 bg-slate-900/50 ${a.past ? 'opacity-50' : ''}`}>
                  <span className="text-slate-200">{a.when} · {a.name || 'Customer'} <span className="text-slate-500">+{a.phone}</span></span>
                  {canEdit && !a.past && <button onClick={() => window.confirm('Cancel this appointment and tell the customer?') && run(() => api.cancelAppointment(a.id), 'Appointment cancelled.')} className="text-slate-400 hover:text-rose-300 underline">Cancel</button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {note && <p className="text-xs text-emerald-400 mt-3">{note}</p>}
      {error && <p className="text-xs text-rose-400 mt-3" role="alert">{error}</p>}
    </div>
  );
}
