import { useCallback, useEffect, useState } from 'react';
import { Instagram, Facebook, Link2, Loader2, MessageSquareReply, Unplug } from 'lucide-react';
import { api } from '../api';
import type { CommentSettings, CommentEvent, MetaStatus } from '../types';

const input = 'w-full bg-sunken border border-line rounded-lg px-3 py-2 text-sm text-fg';
const STATUS: Record<string, string> = { replied: 'bg-brand-soft text-brand-text', skipped: 'bg-subtle text-muted', failed: 'bg-danger-soft text-danger', processing: 'bg-warn-soft text-warn' };

/** Connect the business's Facebook Pages and Instagram accounts, and set up automatic replies to comments on their posts. */
export default function MetaLink({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [settings, setSettings] = useState<CommentSettings | null>(null);
  const [events, setEvents] = useState<CommentEvent[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.metaStatus(), api.metaComments()]);
      setStatus(s);
      setSettings(c.settings);
      setEvents(c.events);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Facebook sends the owner back to /admin/?meta=connected
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const m = q.get('meta');
    if (!m) return;
    if (m === 'connected') setNote(`Connected ${q.get('n') ?? ''} Page${q.get('n') === '1' ? '' : 's'}.${q.get('skipped') ? ` ${q.get('skipped')} could not be connected (already used by another business).` : ''}`);
    else setError(m === 'denied' ? 'Facebook did not give access. Please try again and allow everything it asks for.' : `Could not connect: ${q.get('why') ?? 'please try again'}`);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    load();
  }, [load]);

  async function run(key: string, fn: () => Promise<unknown>, done = '') {
    setBusy(key);
    setError('');
    setNote('');
    try {
      await fn();
      if (done) setNote(done);
      await load();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy('');
    }
  }

  const connect = () => run('connect', async () => { window.location.href = (await api.metaConnect()).url; });
  const disconnect = (pageId: string, name: string) => {
    if (!window.confirm(`Disconnect ${name}? The bot will stop answering its messages and comments.`)) return;
    run(`d-${pageId}`, () => api.metaDisconnect(pageId), 'Disconnected.');
  };
  const save = (patch: Partial<CommentSettings>) => settings && run('save', async () => setSettings((await api.saveMetaComments({ ...settings, ...patch })).settings), 'Saved.');

  if (!status || !settings) return <div className="bg-card border border-line rounded-2xl p-5 text-xs text-muted">{error || 'Loading…'}</div>;

  return (
    <div className="space-y-5">
      <div className="bg-card border border-line rounded-2xl p-5 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold text-fg text-base flex items-center gap-2"><Instagram className="w-4 h-4 text-brand-text" /><Facebook className="w-4 h-4 text-brand-text" /><span>Instagram &amp; Facebook</span></h3>
            <p className="mt-1 text-xs text-muted max-w-xl">The same AI chatbot answers the direct messages of your Facebook Pages and Instagram accounts, with the same questions, leads and team hand-off. Connect as many Pages and Instagram accounts as you manage.</p>
          </div>
          <button onClick={connect} disabled={!!busy || !status.configured} className="px-4 py-2 bg-brand text-on-brand font-bold text-xs rounded-lg disabled:opacity-40 flex items-center gap-1.5">
            {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}<span>{status.connected ? 'Connect more with Facebook' : 'Connect with Facebook'}</span>
          </button>
        </div>
        {!status.configured && <p className="mt-3 text-xs text-warn bg-warn-soft border border-warn-line/50 rounded-lg p-3">Instagram and Facebook are not switched on for this service yet. The platform operator needs to add the Meta app keys first.</p>}
        {error && <p className="mt-3 text-xs text-danger">{error}</p>}
        {note && <p className="mt-3 text-xs text-brand-text">{note}</p>}

        {status.accounts.length > 0 ? (
          <ul className="mt-4 divide-y divide-line border border-line rounded-xl">
            {status.accounts.map((a) => (
              <li key={a.pageId} className="p-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-fg flex items-center gap-1.5"><Facebook className="w-3.5 h-3.5 text-muted" /><span className="truncate">{a.pageName}</span></div>
                  <div className="text-[12.5px] text-muted flex items-center gap-1.5 mt-0.5"><Instagram className="w-3 h-3" />{a.hasInstagram ? `@${a.igUsername || 'instagram account'} linked` : 'No Instagram account linked to this Page'}</div>
                </div>
                <button onClick={() => disconnect(a.pageId, a.pageName)} disabled={!!busy} className="text-xs text-muted hover:text-danger flex items-center gap-1 disabled:opacity-40"><Unplug className="w-3.5 h-3.5" />Disconnect</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-[12.5px] text-muted">Nothing connected yet. You need to be an admin of the Facebook Page. For Instagram, use a Professional (business or creator) account linked to the Page, and turn on “Allow access to messages” in Instagram: Settings, Messages and story replies, Message controls, Connected tools. Facebook then asks which Pages and Instagram accounts to share.</p>
        )}
      </div>

      <div className="bg-card border border-line rounded-2xl p-5 shadow-lg">
        <h3 className="font-bold text-fg text-base flex items-center gap-2"><MessageSquareReply className="w-4 h-4 text-brand-text" /><span>Automatic replies to comments</span></h3>
        <p className="mt-1 text-xs text-muted max-w-xl">When someone comments on one of your posts, the AI replies under the comment and can also send them a private message that starts the chat. Complaints, spam, emoji-only comments and links are left alone for your team. It replies at most once per person per post, and at most 60 times an hour.</p>
        <label className="mt-4 flex items-center gap-2 text-xs text-fg2">
          <input type="checkbox" checked={settings.enabled} disabled={!!busy} onChange={(e) => save({ enabled: e.target.checked })} />
          <span><b>Reply to comments automatically</b> (applies to all connected Pages and Instagram accounts)</span>
        </label>
        {settings.enabled && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-[12.5px] text-muted">Which comments</label>
              <select className={input} value={settings.mode} onChange={(e) => save({ mode: e.target.value as CommentSettings['mode'] })}>
                <option value="keywords">Only comments with a keyword</option>
                <option value="all">All comments</option>
              </select>
            </div>
            {settings.mode === 'keywords' && (
              <div>
                <label className="text-[12.5px] text-muted">Keywords (separate with commas)</label>
                <input className={input} defaultValue={settings.keywords} maxLength={500} onBlur={(e) => e.target.value !== settings.keywords && save({ keywords: e.target.value })} placeholder="price, fees, info, details, interested" />
              </div>
            )}
            <label className="sm:col-span-2 flex items-center gap-2 text-xs text-fg2">
              <input type="checkbox" checked={settings.sendDm} onChange={(e) => save({ sendDm: e.target.checked })} />
              <span>Also send the commenter a private message that starts the conversation (the AI then continues in their DMs)</span>
            </label>
            <div className="sm:col-span-2">
              <label className="text-[12.5px] text-muted">Standard public reply, used only when the AI is unavailable (optional)</label>
              <input className={input} defaultValue={settings.template} maxLength={300} onBlur={(e) => e.target.value !== settings.template && save({ template: e.target.value })} placeholder="Thanks for your comment! We have sent you a message with the details." />
            </div>
          </div>
        )}

        <h4 className="mt-6 text-xs font-bold text-fg">Recent comments</h4>
        {events.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">No comments yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[12px] uppercase tracking-wide text-muted"><th className="py-1.5 pr-3">Comment</th><th className="py-1.5 pr-3">Our reply</th><th className="py-1.5">Result</th></tr></thead>
              <tbody className="divide-y divide-line align-top">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 pr-3 max-w-[16rem]"><div className="text-fg2 truncate" title={e.text}>{e.text}</div><div className="text-[12px] text-muted">{e.channel === 'ig' ? 'Instagram' : 'Facebook'} · {e.commenter || 'someone'} · {new Date(e.at).toLocaleString()}</div></td>
                    <td className="py-2 pr-3 max-w-[18rem] text-fg2"><div className="truncate" title={e.reply}>{e.reply || '—'}</div>{e.dm && <div className="text-[12px] text-muted truncate" title={e.dm}>DM: {e.dm}</div>}</td>
                    <td className="py-2"><span className={`px-2 py-0.5 rounded-full text-[12px] font-semibold ${STATUS[e.status] ?? STATUS.skipped}`}>{e.status}</span>{e.note && <div className="text-[12px] text-muted mt-0.5 max-w-[14rem]">{e.note}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
