import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AnalyticsData } from '../types';

const pct = (n: number) => `${Math.round(n * 100)}%`;
const card = 'bg-card border border-line rounded-2xl p-5 shadow-lg';

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="bg-card/70 border border-line/80 rounded-xl p-3.5">
      <p className="text-[11px] font-medium text-muted uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-0.5 text-fg">{value}</p>
      {hint && <p className="text-[11px] text-muted mt-0.5">{hint}</p>}
    </div>
  );
}

/** Horizontal bar: one hue, thin, value as text so it never relies on colour alone. */
function Bar({ label, value, max, right }: { label: string; value: number; max: number; right?: string }) {
  return (
    <div title={`${label}: ${value}`}>
      <div className="flex justify-between text-xs mb-1 gap-3">
        <span className="text-fg2 truncate">{label}</span>
        <span className="text-muted whitespace-nowrap">{right ?? value}</span>
      </div>
      <div className="h-2 rounded-full bg-subtle overflow-hidden">
        <div className="h-full rounded-full bg-brand" style={{ width: `${max ? Math.max((value / max) * 100, value ? 2 : 0) : 0}%` }} />
      </div>
    </div>
  );
}

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState('');
  const [table, setTable] = useState(false);

  useEffect(() => {
    setD(null);
    api.analytics(days).then(setD).catch((e) => setError((e as Error).message));
  }, [days]);

  const peak = useMemo(() => Math.max(1, ...(d?.series.map((s) => s.started) ?? [1])), [d]);

  if (!d) return <div className={card + ' text-xs text-muted'}>{error || 'Loading analytics…'}</div>;
  const t = d.totals;
  const funnel = [
    { label: 'Started a chat', value: t.started },
    { label: 'Chose a service', value: t.pickedService },
    { label: 'Finished the questions (leads)', value: t.leads },
    { label: 'Booked', value: t.booked },
    { label: 'Won', value: t.won }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-fg font-bold">Last {days} days</h2>
        <div className="flex gap-1.5">
          {[7, 30, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${days === n ? 'bg-brand-soft text-brand-text border-brand/50' : 'bg-sunken text-muted border-line hover:text-fg'}`}>{n} days</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Conversations" value={t.started} />
        <Tile label="Leads" value={t.leads} hint={`${pct(t.completionRate)} finish the questions`} />
        <Tile label="Booked / won" value={`${t.booked} / ${t.won}`} />
        <Tile label="Typical time to finish" value={t.medianMinutesToComplete === null ? '—' : `${t.medianMinutesToComplete} min`} hint="median, first message to last answer" />
      </div>

      <div className={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-bold text-fg text-base">Conversations and leads per day</h3>
          <div className="flex items-center gap-4 text-[11px] text-muted">
            <span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-muted" /><span>Conversations</span></span>
            <span className="flex items-center space-x-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-brand" /><span>Leads</span></span>
            <button onClick={() => setTable((x) => !x)} className="text-brand-text underline">{table ? 'Show chart' : 'Show table'}</button>
          </div>
        </div>
        {!table ? (
          <div className="mt-4 flex items-end gap-[3px] h-40" role="img" aria-label="Daily conversations and leads">
            {d.series.map((s) => (
              <div key={s.day} className="flex-1 min-w-0 h-full flex flex-col justify-end group relative" title={`${s.day}: ${s.started} conversations, ${s.leads} leads`}>
                <div className="flex items-end gap-[2px] h-full">
                  <div className="flex-1 rounded-t bg-muted" style={{ height: `${(s.started / peak) * 100}%`, minHeight: s.started ? 2 : 0 }} />
                  <div className="flex-1 rounded-t bg-brand" style={{ height: `${(s.leads / peak) * 100}%`, minHeight: s.leads ? 2 : 0 }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 max-h-56 overflow-y-auto text-xs">
            <table className="w-full text-left"><thead className="text-muted"><tr><th className="py-1">Day</th><th>Conversations</th><th>Leads</th></tr></thead>
              <tbody>{d.series.filter((s) => s.started || s.leads).map((s) => <tr key={s.day} className="border-t border-line/60 text-fg2"><td className="py-1">{s.day}</td><td>{s.started}</td><td>{s.leads}</td></tr>)}</tbody></table>
          </div>
        )}
        <div className="flex justify-between text-[10px] text-muted mt-1"><span>{d.series[0]?.day}</span><span>{d.series[d.series.length - 1]?.day}</span></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className={card}>
          <h3 className="font-bold text-fg text-base mb-4">Funnel</h3>
          <div className="space-y-3">
            {funnel.map((f, i) => (
              <Bar key={f.label} label={f.label} value={f.value} max={funnel[0].value} right={`${f.value}${i > 0 && funnel[0].value ? ` · ${pct(f.value / funnel[0].value)}` : ''}`} />
            ))}
          </div>
        </div>

        <div className={card}>
          <h3 className="font-bold text-fg text-base mb-4">Leads by pipeline stage</h3>
          <div className="space-y-3">
            {d.byStage.map((s) => <Bar key={s.key} label={s.label} value={s.count} max={Math.max(1, ...d.byStage.map((x) => x.count))} />)}
          </div>
        </div>

        <div className={card}>
          <h3 className="font-bold text-fg text-base mb-4">By service</h3>
          {d.byService.length === 0 && <p className="text-xs text-muted">No conversations in this period.</p>}
          <div className="space-y-3">
            {d.byService.map((s) => <Bar key={s.key ?? 'none'} label={s.title} value={s.started} max={d.byService[0].started} right={`${s.started} chats · ${s.leads} leads${s.started ? ` (${pct(s.leads / s.started)})` : ''}`} />)}
          </div>
        </div>

        <div className={card}>
          <h3 className="font-bold text-fg text-base mb-1">By campaign</h3>
          <p className="text-[11px] text-muted mb-4">From the tag on your click-to-chat links. &ldquo;(direct)&rdquo; = no tag.</p>
          <div className="space-y-3">
            {d.bySource.map((s) => <Bar key={s.source} label={s.source} value={s.started} max={d.bySource[0].started} right={`${s.started} chats · ${s.leads} leads`} />)}
          </div>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-bold text-fg text-base mb-1">Where customers give up</h3>
        <p className="text-[11px] text-muted mb-4">Questions after which people stopped replying for over a day. Shorten or reword the top ones in Settings.</p>
        {d.dropOffs.length === 0 ? (
          <p className="text-xs text-muted">No abandoned chats in this period.</p>
        ) : (
          <div className="space-y-3">
            {d.dropOffs.map((x) => <Bar key={x.service + x.question} label={`${x.service} · ${x.question}`} value={x.count} max={d.dropOffs[0].count} right={`${x.count} left here`} />)}
          </div>
        )}
      </div>
    </div>
  );
}
