import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '../supabaseClient';

const SECTIONS = [
  ['since_last_meeting', 'Since the last meeting'], ['decisions_to_remember', 'Decisions to remember'],
  ['unresolved_topics', 'Unresolved topics'], ['suggested_agenda', 'Suggested agenda'], ['risks', 'Risks'],
];

export default function ContextBriefingSection({ meeting, plannedMeeting, readOnly = false }) {
  const [briefings, setBriefings] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(!!(meeting?.project_id || plannedMeeting?.project_id));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [agenda, setAgenda] = useState('');
  const target = plannedMeeting || meeting;
  const isPlannedMeeting = !!plannedMeeting;
  const targetId = target?.id;
  const projectId = target?.project_id;
  const briefing = briefings.find((b) => b.id === selectedId) || briefings[0];
  const plannedMeetingChanged = isPlannedMeeting && briefing?.generated_at && target?.updated_at
    && Date.parse(target.updated_at) > Date.parse(briefing.generated_at);

  const load = useCallback(async () => {
    if (!projectId || !targetId) {
      setLoading(false);
      setBriefings([]);
      setSelectedId('');
      return;
    }
    setLoading(true);
    try {
      let query = supabase.from('briefings').select('*').eq('project_id', projectId);
      query = isPlannedMeeting ? query.eq('planned_meeting_id', targetId) : query.eq('meeting_id', targetId);
      const result = await query.order('created_at', { ascending: false }).limit(10);
      if (result.error) throw result.error;
      const nextBriefings = result.data || [];
      setBriefings(nextBriefings);
      setSelectedId((current) => nextBriefings.some((b) => b.id === current) ? current : (nextBriefings[0]?.id || ''));
      setError('');
    } catch { setError('Context briefings could not be loaded. Check that the context migration is installed, then retry.'); }
    finally { setLoading(false); }
  }, [isPlannedMeeting, projectId, targetId]);

  useEffect(() => {
    // Parent keys this component by meeting/project, so state starts clean.
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (briefing?.source_meeting_ids?.length) {
      supabase.from('meetings').select('id,title').in('id', briefing.source_meeting_ids).then(({ data }) => {
        if (!cancelled) setSources(data || []);
      });
    }
    return () => { cancelled = true; };
  }, [briefing?.id, briefing?.source_meeting_ids]);

  // Handles a concurrent Generate response without requiring new Realtime setup.
  useEffect(() => {
    if (!briefings.some((b) => b.status === 'generating' && Date.now() - Date.parse(b.updated_at) < 600000)) return undefined;
    const timer = setTimeout(load, 5000);
    return () => clearTimeout(timer);
  }, [briefings, load]);

  const generate = async () => {
    setGenerating(true); setError('');
    try {
      const body = isPlannedMeeting
        ? { planned_meeting_id: target.id, refresh: !!briefing }
        : { meeting_id: target.id, ...(agenda.trim() ? { agenda: agenda.trim() } : {}), refresh: !!briefing };
      const { data, error: invokeError } = await supabase.functions.invoke('generate-briefing', { body });
      if (invokeError) {
        let message = invokeError.message;
        try { message = (await invokeError.context?.json())?.error || message; } catch { /* use transport message */ }
        throw new Error(message);
      }
      if (!data?.success) throw new Error(data?.error || 'Briefing generation failed.');
      if (data.briefing?.id) setSelectedId(data.briefing.id);
      await load();
    } catch (err) { setError(err.message || 'Briefing generation failed. Please retry.'); await load(); }
    finally { setGenerating(false); }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#0084FF]" /> Context Briefing
        </h4>
        {!readOnly && <button type="button" onClick={generate} disabled={!projectId || !targetId || generating || loading || (isPlannedMeeting && target?.status === 'cancelled')}
          className="px-3 py-1.5 rounded-xl bg-white border border-sky-200 text-xs font-bold text-[#0084FF] disabled:opacity-50 cursor-pointer flex items-center gap-1.5">
          {generating && <RefreshCw className="w-3 h-3 animate-spin" />}
          {generating ? 'Generating…' : briefing ? 'Refresh' : 'Generate'}
        </button>}
      </div>
      {!targetId ? <p className="text-xs text-slate-500">This meeting does not have a briefing target yet.</p>
        : !projectId ? <p className="text-xs text-slate-500">Assign this {isPlannedMeeting ? 'planned meeting' : 'meeting'} to a project to generate a context briefing.</p> : <>
        {isPlannedMeeting ? <div className="rounded-xl border border-sky-100 bg-white/70 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-900">Agenda:</span> {target.agenda || 'No agenda provided.'}
        </div> : <label className="block text-xs text-slate-600">
          Agenda <span className="text-slate-400">(optional)</span>
          <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} maxLength={12000} rows={2}
            placeholder="What should this briefing focus on?"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-[#0084FF]" />
        </label>}
        {plannedMeetingChanged && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          The agenda or scheduled time changed after this briefing was generated. Refresh the briefing to use the latest plan.
        </div>}
        {loading && <p role="status" className="text-xs text-slate-500">Loading context briefings…</p>}
        {error && <div role="alert" className="flex items-start gap-2 text-xs text-amber-800 rounded-xl bg-amber-50 p-3">
          <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
          <button type="button" onClick={() => { setError(''); load(); }} className="font-bold underline">Retry</button>
        </div>}
        {!loading && !briefing && !error && <p className="text-xs text-slate-500">No context briefing yet. Generate one from this project’s eligible meeting history.</p>}
        {isPlannedMeeting && target.status === 'cancelled' && <p className="text-xs text-slate-500">This planned meeting is cancelled. Existing briefing history remains available.</p>}
        {briefings.length > 1 && <label className="block text-xs text-slate-600">Saved briefings (latest first)
          <select value={briefing?.id || ''} onChange={(e) => setSelectedId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-xs">
            {briefings.map((b) => <option key={b.id} value={b.id}>{new Date(b.created_at).toLocaleString()} — {b.status}</option>)}
          </select>
        </label>}
        {briefing?.status === 'generating' && <p role="status" className="text-xs text-slate-500">Briefing generation is in progress. This section updates automatically; use Refresh if it stalls.</p>}
        {briefing?.status === 'failed' && <p className="text-xs text-amber-800">{briefing.error_message || 'Generation failed. Use Refresh to retry.'}</p>}
        {briefing?.status === 'ready' && briefing.content && <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
          <p className="font-semibold text-slate-900">{briefing.content.headline}</p>
          {SECTIONS.map(([key, label]) => Array.isArray(briefing.content[key]) && briefing.content[key].length > 0 && <div key={key}>
            <h5 className="font-bold text-slate-900">{label}</h5>
            <ul className="list-disc pl-4 space-y-1">{briefing.content[key].map((item, i) => <li key={i}>
              {typeof item === 'string' ? item : item.text}
              {item?.meeting_ids?.filter((id) => sources.some((s) => s.id === id)).map((id) =>
                <Link key={id} to={`/meetings/${id}`} className="ml-1 text-[#0084FF] underline">[source]</Link>)}
            </li>)}</ul>
          </div>)}
          {briefing.content.open_tasks?.length > 0 && <div><h5 className="font-bold text-slate-900">Open tasks</h5>
            <ul className="list-disc pl-4 space-y-1">{briefing.content.open_tasks.map((task) => <li key={task.task_id}>
              {task.task} · {task.assignee || 'Unassigned'} · {task.due || 'No deadline'} · {task.status}
            </li>)}</ul>
          </div>}
          <div className="border-t border-sky-100 pt-2 space-y-1">
            <h5 className="font-bold text-slate-900">Sources</h5>
            {sources.some((s) => briefing.source_meeting_ids?.includes(s.id)) ? sources.filter((s) => briefing.source_meeting_ids?.includes(s.id)).map((source) => <Link key={source.id} to={`/meetings/${source.id}`}
              className="block text-[#0084FF] underline">{source.title || 'Untitled meeting'}</Link>) : <p>No historical meeting sources.</p>}
          </div>
        </div>}
      </>}
    </section>
  );
}
