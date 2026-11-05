import { useCallback, useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { api } from '../api';
import type { AdminUser, CalendarInfo } from '../types';

const card = 'bg-card border border-line rounded-2xl p-5 shadow-lg';
const input = 'bg-sunken border border-line rounded-lg px-3 py-2 text-xs text-fg focus:outline-none focus:border-brand/40';
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

  if (!info) return <div className={card + ' text-xs text-muted'}>{error || 'Loading appointments…'}</div>;
  const set = (k: string, v: number | string) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const toggleDay = (n: number) => setForm((f) => f && { ...f, workDays: f.workDays.includes(n) ? f.workDays.filter((d) => d !== n) : [...f.workDays, n].sort() });

  return (
    <div className={card}>
      <h3 className="font-bold text-fg text-base flex items-center space-x-2"><CalendarDays className="w-4 h-4 text-brand-text" /><span>Appointments</span></h3>
      <p className="text-[11px] text-muted mt-1">
        Turn on booking and the bot lets customers pick a date and a time, books it, confirms it to them on WhatsApp, alerts you on WhatsApp and reminds them before it starts. Use the built-in calendar, or connect Google Calendar so the bot also avoids your other events and adds each booking to it. Times use your business time zone ({info.timezone}).
      </p>

      {!info.connected && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canEdit && <button onClick={() => run(() => api.calendarBuiltin(), 'Booking is on. Set your working hours below.')} disabled={busy} className="px-4 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg disabled:opacity-50">Turn on booking (built-in calendar)</button>}
          {info.googleAvailable ? (
            canEdit && <button onClick={connect} disabled={busy} className="px-4 py-2 bg-subtle hover:bg-subtle text-fg font-semibold text-xs rounded-lg border border-line disabled:opacity-50">Connect Google Calendar instead</button>
          ) : (
            <p className="text-[11px] text-warn">Google sign-in is not set up on this server yet. The platform operator needs to add the Google keys first.</p>
          )}
        </div>
      )}

      {info.connected && form && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <span className="px-2.5 py-1 rounded-full border bg-brand-soft text-brand-text border-brand/40 font-semibold">{info.builtin ? 'Booking is on · built-in calendar' : `Google Calendar connected${info.email ? ` · ${info.email}` : ''}`}</span>
            {info.builtin && info.googleAvailable && canEdit && <button onClick={connect} disabled={busy} className="text-brand-text hover:text-brand-text underline">Connect Google Calendar too</button>}
            {canEdit && <button onClick={() => window.confirm(info.builtin ? 'Turn off booking? The bot will stop offering times. Existing appointments stay on record.' : 'Disconnect Google Calendar and turn off booking? The bot will stop offering times. Existing appointments stay in your calendar.') && run(() => api.calendarDisconnect(), 'Booking is off.')} className="text-muted hover:text-danger underline">{info.builtin ? 'Turn off booking' : 'Disconnect'}</button>}
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px] text-muted">
            <label>Appointment length (min)<input type="number" min={10} max={240} step={5} value={form.slotMinutes} disabled={!canEdit} onChange={(e) => set('slotMinutes', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Break between (min)<input type="number" min={0} max={120} step={5} value={form.bufferMinutes} disabled={!canEdit} onChange={(e) => set('bufferMinutes', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Opens<input type="time" value={form.workStart} disabled={!canEdit} onChange={(e) => set('workStart', e.target.value)} className={input + ' block mt-1 w-full'} /></label>
            <label>Closes<input type="time" value={form.workEnd} disabled={!canEdit} onChange={(e) => set('workEnd', e.target.value)} className={input + ' block mt-1 w-full'} /></label>
            <label>Minimum notice (hours)<input type="number" min={0} max={168} value={form.noticeHours} disabled={!canEdit} onChange={(e) => set('noticeHours', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Book up to (days ahead)<input type="number" min={1} max={60} value={form.daysAhead} disabled={!canEdit} onChange={(e) => set('daysAhead', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
            <label>Remind customer (hours before, 0 = off)<input type="number" min={0} max={48} value={form.reminderHours} disabled={!canEdit} onChange={(e) => set('reminderHours', Number(e.target.value))} className={input + ' block mt-1 w-full'} /></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>Working days:</span>
            {DAYS.map((d, i) => (
              <button key={d} type="button" disabled={!canEdit} onClick={() => toggleDay(i + 1)}
                className={`px-2.5 py-1 rounded-lg border ${form.workDays.includes(i + 1) ? 'bg-brand-soft border-brand/50 text-brand-text' : 'border-line text-muted'}`}>{d}</button>
            ))}
          </div>
          {canEdit && <button onClick={() => run(() => api.calendarSave(form), 'Saved.')} disabled={busy} className="mt-4 px-5 py-2 bg-brand hover:bg-brand text-on-brand font-bold text-xs rounded-lg disabled:opacity-50">Save</button>}

          <h4 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted">Upcoming appointments</h4>
          {info.appointments.length === 0 ? (
            <p className="text-[11px] text-muted mt-2">None yet. Customers book by replying BOOK after they finish the questions.</p>
          ) : (
            <div className="mt-2 divide-y divide-line/70 border border-line rounded-xl overflow-hidden text-xs">
              {info.appointments.map((a) => (
                <div key={a.id} className={`flex items-center justify-between px-3.5 py-2 bg-sunken/50 ${a.past ? 'opacity-50' : ''}`}>
                  <span className="text-fg">{a.when} · {a.name || 'Customer'} <span className="text-muted">+{a.phone}</span></span>
                  {canEdit && !a.past && <button onClick={() => window.confirm('Cancel this appointment and tell the customer?') && run(() => api.cancelAppointment(a.id), 'Appointment cancelled.')} className="text-muted hover:text-danger underline">Cancel</button>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {note && <p className="text-xs text-brand-text mt-3">{note}</p>}
      {error && <p className="text-xs text-danger mt-3" role="alert">{error}</p>}
    </div>
  );
}
