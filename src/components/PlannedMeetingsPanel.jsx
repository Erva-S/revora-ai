import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Calendar, Check, Edit3, Loader2, PlusCircle, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import { supabase } from '../supabaseClient';
import ContextBriefingSection from './ContextBriefingSection';

const emptyForm = {
  title: '',
  projectId: '',
  userId: '',
  scheduledFor: '',
  agenda: '',
  meetingUrl: '',
};

const isMigrationError = (error) => {
  const text = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('planned_meetings') || text.includes('schema cache') || text.includes('42p01');
};

const localDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
};

const displayDate = (value) => value ? new Date(value).toLocaleString([], {
  month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : 'Time not set';

export default function PlannedMeetingsPanel({ projects = [], assignableUsers = [], currentUserId = '' }) {
  const [plannedMeetings, setPlannedMeetings] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ ...emptyForm, userId: currentUserId || '' });
  const [editingId, setEditingId] = useState(null);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [linkMeetingId, setLinkMeetingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [migrationUnavailable, setMigrationUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selected = plannedMeetings.find((meeting) => meeting.id === selectedId) || null;

  useEffect(() => {
    if (selected) setMeetingUrl(selected.meeting_url || '');
  }, [selectedId]);

  useEffect(() => {
    if (!editingId && !form.userId && currentUserId) setForm((current) => ({ ...current, userId: currentUserId }));
  }, [currentUserId, editingId, form.userId]);

  const projectLabel = (projectId) => {
    const project = projects.find((item) => item.id === projectId);
    return project ? `${project.clients?.name ? `${project.clients.name} / ` : ''}${project.name}` : projectId || 'Project unavailable';
  };

  const userLabel = (userId) => {
    if (!userId) return 'Admins only';
    const user = assignableUsers.find((item) => item.id === userId);
    return user?.name || user?.email || userId;
  };

  const loadPlannedMeetings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await supabase.from('planned_meetings').select('*').order('scheduled_for', { ascending: true });
      if (result.error) throw result.error;
      const rows = result.data || [];
      setPlannedMeetings(rows);
      setMigrationUnavailable(false);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : (rows[0]?.id || ''));
    } catch (loadError) {
      setPlannedMeetings([]);
      setSelectedId('');
      if (isMigrationError(loadError)) {
        setMigrationUnavailable(true);
        setError('Planned meetings are unavailable because the planned-meetings migration is not installed. Apply the migration, then retry.');
      } else {
        setError(loadError.message || 'Planned meetings could not be loaded.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadPlannedMeetings, 0);
    return () => clearTimeout(timer);
  }, [loadPlannedMeetings]);

  const selectMeeting = (meeting) => {
    setSelectedId(meeting.id);
    setMeetingUrl('');
    setLinkMeetingId('');
    setNotice('');
  };

  const startEdit = (meeting) => {
    setSelectedId(meeting.id);
    setEditingId(meeting.id);
    setForm({
      title: meeting.title || '',
      projectId: meeting.project_id || '',
      userId: meeting.user_id || '',
      scheduledFor: localDateTime(meeting.scheduled_for),
      agenda: meeting.agenda || '',
      meetingUrl: meeting.meeting_url || '',
    });
    setNotice('');
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...emptyForm, userId: currentUserId || '' });
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.projectId || !form.scheduledFor) return;

    let scheduledFor;
    try {
      scheduledFor = new Date(form.scheduledFor).toISOString();
    } catch {
      setError('Choose a valid date and time.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      const values = {
        title: form.title.trim(),
        project_id: form.projectId,
        user_id: form.userId || null,
        scheduled_for: scheduledFor,
        agenda: form.agenda.trim(),
        meeting_url: form.meetingUrl.trim() || null,
      };
      if (!editingId) values.created_by = currentUserId || null;
      const result = editingId
        ? await supabase.from('planned_meetings').update(values).eq('id', editingId).select('*').single()
        : await supabase.from('planned_meetings').insert(values).select('*').single();
      if (result.error) throw result.error;
      setPlannedMeetings((current) => editingId
        ? current.map((row) => row.id === editingId ? result.data : row)
        : [...current, result.data].sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for)));
      setSelectedId(result.data.id);
      setMeetingUrl('');
      setLinkMeetingId('');
      setNotice(editingId ? 'Planned meeting updated.' : 'Planned meeting created.');
      resetForm();
    } catch (saveError) {
      if (isMigrationError(saveError)) {
        setMigrationUnavailable(true);
        setError('Planned meetings are unavailable because the planned-meetings migration is not installed. Apply the migration, then retry.');
      } else {
        setError(saveError.message || 'Planned meeting could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  };

  const cancelMeeting = async (meeting) => {
    if (meeting.status === 'cancelled' || !window.confirm(`Cancel "${meeting.title || 'this planned meeting'}"?`)) return;
    setError('');
    setNotice('');
    try {
      const result = await supabase.from('planned_meetings').update({ status: 'cancelled' }).eq('id', meeting.id).select('*').single();
      if (result.error) throw result.error;
      setPlannedMeetings((current) => current.map((row) => row.id === meeting.id ? result.data : row));
      if (editingId === meeting.id) resetForm();
      setNotice('Planned meeting cancelled.');
    } catch (cancelError) {
      if (isMigrationError(cancelError)) {
        setMigrationUnavailable(true);
        setError('Planned meetings are unavailable because the planned-meetings migration is not installed. Apply the migration, then retry.');
      } else {
        setError(cancelError.message || 'Planned meeting could not be cancelled.');
      }
    }
  };

  const deployBot = async (event) => {
    event.preventDefault();
    if (!selected || selected.status !== 'planned' || selected.linked_meeting_id) return;
    setDeploying(true);
    setError('');
    setNotice('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('deploy-bot', {
        body: { planned_meeting_id: selected.id, meeting_url: meetingUrl.trim() },
      });
      if (invokeError) {
        let message = invokeError.message;
        try { message = (await invokeError.context?.json())?.error || message; } catch { /* use transport message */ }
        throw new Error(message);
      }
      if (!data?.success) throw new Error(data?.error || 'Bot deployment failed.');
      setNotice(data.planned_link === 'failed'
        ? 'Bot deployed, but the planned meeting could not be linked automatically.'
        : 'Bot deployed to the planned meeting.');
      setLinkMeetingId(data.planned_link === 'failed' ? (data.meeting_id || '') : '');
      setMeetingUrl('');
      await loadPlannedMeetings();
    } catch (deployError) {
      setError(deployError.message || 'Bot deployment failed.');
    } finally {
      setDeploying(false);
    }
  };

  const retryLink = async () => {
    if (!selected || !linkMeetingId || deploying) return;
    setDeploying(true);
    setError('');
    setNotice('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('deploy-bot', {
        body: { planned_meeting_id: selected.id, meeting_id: linkMeetingId, retry_link: true },
      });
      if (invokeError) {
        let message = invokeError.message;
        try { message = (await invokeError.context?.json())?.error || message; } catch { /* use transport message */ }
        throw new Error(message);
      }
      if (!data?.success || data.planned_link !== 'linked') throw new Error(data?.error || 'The planned meeting link is still unavailable.');
      setLinkMeetingId('');
      setNotice('The existing bot was linked to the planned meeting.');
      await loadPlannedMeetings();
    } catch (retryError) {
      setError(retryError.message || 'The planned meeting link could not be retried.');
    } finally {
      setDeploying(false);
    }
  };

  return (
    <section className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="font-outfit font-bold text-base text-slate-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#0084FF]" />
            Planned Meetings
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Prepare context before dispatching a meeting bot.</p>
        </div>
        <button type="button" onClick={loadPlannedMeetings} disabled={loading}
          className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-500 transition-colors cursor-pointer w-fit" title="Refresh planned meetings">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0084FF]' : ''}`} />
        </button>
      </div>

      {migrationUnavailable ? <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs space-y-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
        <button type="button" onClick={loadPlannedMeetings} className="font-bold underline cursor-pointer">Retry</button>
      </div> : <>
        {error && <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
        </div>}
        {notice && <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" /><span>{notice}</span>
        </div>}

        <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              {editingId ? <Edit3 className="w-3.5 h-3.5 text-[#0084FF]" /> : <PlusCircle className="w-3.5 h-3.5 text-[#0084FF]" />}
              {editingId ? 'Edit planned meeting' : 'Create planned meeting'}
            </h4>
            {editingId && <button type="button" onClick={resetForm} className="text-[11px] font-bold text-slate-500 hover:text-slate-900 cursor-pointer">Cancel edit</button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              Title
              <input required maxLength={200} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="Quarterly planning sync" className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-normal normal-case outline-none focus:border-[#0084FF]" />
            </label>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              Project
              <select required value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}
                className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-normal normal-case outline-none focus:border-[#0084FF]">
                <option value="">Choose a project</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{projectLabel(project.id)}</option>)}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              Scheduled time
              <input required type="datetime-local" value={form.scheduledFor} onChange={(event) => setForm({ ...form, scheduledFor: event.target.value })}
                className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-normal normal-case outline-none focus:border-[#0084FF]" />
            </label>
            <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
              Assign to
              <select value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })}
                className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-normal normal-case outline-none focus:border-[#0084FF]">
                <option value="">Admins only</option>
                {assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.name || user.email} ({user.email})</option>)}
              </select>
            </label>
          </div>
          <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            Agenda
            <textarea rows={2} maxLength={12000} value={form.agenda} onChange={(event) => setForm({ ...form, agenda: event.target.value })}
              placeholder="Topics, goals, and preparation notes" className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-normal normal-case outline-none focus:border-[#0084FF] resize-none" />
          </label>
          <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            Meeting link <span className="font-normal normal-case text-slate-400">(optional; can be added at deployment)</span>
            <input type="url" value={form.meetingUrl} onChange={(event) => setForm({ ...form, meetingUrl: event.target.value })}
              placeholder="https://meet.google.com/..." className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-normal normal-case outline-none focus:border-[#0084FF]" />
          </label>
          <div className="flex justify-end">
            <button type="submit" disabled={saving || !projects.length}
              className="px-4 py-2 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create planned meeting'}
            </button>
          </div>
          {!projects.length && <p className="text-[11px] text-amber-700">Projects are unavailable, so a planned meeting cannot be created yet.</p>}
        </form>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Planned rows</h4>
            <span className="text-[11px] font-mono text-slate-500">{plannedMeetings.length} total</span>
          </div>
          {loading && plannedMeetings.length === 0 && <p role="status" className="text-xs text-slate-500">Loading planned meetings…</p>}
          {!loading && plannedMeetings.length === 0 && <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">No planned meetings yet.</div>}
          {plannedMeetings.map((meeting) => (
            <div key={meeting.id} className={`p-4 rounded-xl border transition-colors ${selected?.id === meeting.id ? 'border-sky-200 bg-sky-50/40' : 'border-slate-200 bg-slate-50/60'}`}>
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <button type="button" onClick={() => selectMeeting(meeting)} className="text-left min-w-0 cursor-pointer">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h5 className="font-bold text-sm text-slate-900">{meeting.title || 'Untitled planned meeting'}</h5>
                     <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${meeting.status === 'cancelled' ? 'bg-slate-100 text-slate-500 border-slate-200' : meeting.linked_meeting_id ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-sky-50 text-[#0084FF] border-sky-200'}`}>
                       {meeting.linked_meeting_id ? 'linked' : meeting.status || 'planned'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{displayDate(meeting.scheduled_for)} · {projectLabel(meeting.project_id)} · {userLabel(meeting.user_id)}</p>
                  {meeting.agenda && <p className="text-xs text-slate-600 mt-2 line-clamp-2">{meeting.agenda}</p>}
                </button>
                <div className="flex items-center gap-2 shrink-0">
                   <button type="button" onClick={() => startEdit(meeting)} disabled={meeting.status !== 'planned' || !!meeting.linked_meeting_id}
                    className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:border-sky-200 hover:text-[#0084FF] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">Edit</button>
                   <button type="button" onClick={() => cancelMeeting(meeting)} disabled={meeting.status !== 'planned' || !!meeting.linked_meeting_id}
                    className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">Cancel</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {selected && <div className="space-y-4 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Selected planned meeting</h4>
              <p className="text-[11px] text-slate-500 mt-1">{selected.title} · {displayDate(selected.scheduled_for)}</p>
            </div>
            <button type="button" onClick={() => { setSelectedId(''); setMeetingUrl(''); }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer" title="Clear selection">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
           <ContextBriefingSection key={`${selected.id}:${selected.project_id}:${selected.updated_at || ''}`} plannedMeeting={selected}
             readOnly={selected.status === 'linked' || !!selected.linked_meeting_id} />
           {selected.linked_meeting_id ? <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
             <Check className="w-4 h-4 shrink-0" /> Bot already deployed for this planned meeting.
           </div> : selected.status === 'cancelled' ? <p className="text-xs text-slate-500">Cancelled planned meetings cannot receive a bot.</p> : <form onSubmit={deployBot} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0084FF]" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Deploy bot</h4>
            </div>
            <p className="text-[11px] text-slate-500">Provide the live meeting URL when you are ready to dispatch the bot.</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input required type="url" value={meetingUrl} onChange={(event) => setMeetingUrl(event.target.value)} placeholder="https://meet.google.com/..." disabled={deploying}
                className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-xs outline-none focus:border-[#0084FF]" />
               <button type="submit" disabled={deploying || !!linkMeetingId || !meetingUrl.trim()} className="px-4 py-2.5 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed">
                {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {deploying ? 'Deploying…' : 'Deploy bot'}
              </button>
             </div>
             {linkMeetingId && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2 text-xs text-amber-800">
               <p>The bot was dispatched, but the planned row was not linked. Retrying this link will not dispatch another bot.</p>
               <button type="button" onClick={retryLink} disabled={deploying}
                 className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-[11px] font-bold text-amber-800 disabled:opacity-50 cursor-pointer">
                 {deploying ? 'Retrying…' : 'Retry link'}
               </button>
             </div>}
           </form>}
        </div>}
      </>}
    </section>
  );
}
