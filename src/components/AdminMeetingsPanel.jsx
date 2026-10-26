import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import ActionItemCard from './ActionItemCard';
import ContextBriefingSection from './ContextBriefingSection';
import MeetingProjectAssignment from './MeetingProjectAssignment';
import MeetingRecordingLink from './MeetingRecordingLink';
import { meetingStageLabel, meetingStageClasses } from '../lib/meetingStatus';
import { transcriptDisplayText, transcriptParagraphs } from '../lib/transcriptDisplay';
import { applyMeetingChange, isActiveMeeting, mergeMeetingRows, subscribeToMeetingChanges } from '../lib/meetingRealtime';
import { RefreshCw, Clock, AlertCircle, Bot, Users, Building2, FolderGit2 } from 'lucide-react';

/**
 * Admin-side meeting monitor.
 *
 * Meeting monitor with additive project assignment (RLS grants
 * admins every row via public.is_admin()): bot id, pipeline status, and the
 * post-meeting results produced by the existing webhook + Gemini pipeline
 * (recording, summary, transcript, action items).
 *
 * This panel never calls the deploy-bot function — deployment stays in
 * MeetingBotDeployer, which the Edge Function authorizes server-side.
 */
export default function AdminMeetingsPanel({ refreshKey = 0, users = [] }) {
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [linkedPlannedMeeting, setLinkedPlannedMeeting] = useState(null);
  const [error, setError] = useState(null);
  const requestVersion = useRef(0);
  const refreshTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLinkedPlannedMeeting(null);
    if (!selected?.id) return () => { cancelled = true; };
    supabase.from('planned_meetings').select('*').eq('linked_meeting_id', selected.id).maybeSingle()
      .then(({ data, error: lookupError }) => {
        if (!cancelled && !lookupError) setLinkedPlannedMeeting(data || null);
      });
    return () => { cancelled = true; };
  }, [selected?.id]);

  const ownerLabel = (userId) => {
    if (!userId) return 'Admins only';
    const match = users.find((u) => u.id === userId);
    return match?.email || match?.name || userId;
  };

  const fetchMeetings = async ({ silent = false } = {}) => {
    const requestId = ++requestVersion.current;
    try {
      if (!silent) setLoading(true);
      const { data, error: queryError } = await supabase
        .from('meetings')
        .select('*, projects(id, name, clients(id, name)), clients(id, name)')
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;
      if (requestId < requestVersion.current) return;
      setMeetings((current) => mergeMeetingRows(current, data || []));
      setError(null);

      // Keep the detail modal in sync: if a meeting is currently selected,
      // refresh it from the latest data so the user sees live status updates
      // without closing and re-opening the modal.
      setSelected((prev) => {
        if (!prev || !data) return prev;
         const updated = data.find((m) => m.id === prev.id);
         return updated || prev;
      });
    } catch (err) {
      console.error('Admin meetings query failed:', err);
      setError(err.message || 'Failed to load meetings.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Refetch on mount, when a bot is deployed (refreshKey bumps), and on any
  // realtime change the webhook writes while a meeting is being processed.
  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => { fetchMeetings({ silent: true }); }, 250);
    };
    fetchMeetings();

    const unsubscribe = subscribeToMeetingChanges('admin_meetings_monitor', {
      onChange: (payload) => {
        setMeetings((current) => applyMeetingChange(current, payload));
        if (payload?.new?.id) {
          setSelected((current) => {
            if (!current || current.id !== payload.new.id) return current;
            return mergeMeetingRows([current], [payload.new])[0] || current;
          });
        }
        scheduleRefresh();
      },
      onStatus: (status, realtimeErr) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Admin realtime subscription notice:', realtimeErr?.message || status);
          fetchMeetings({ silent: true });
        }
      },
    });

    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') fetchMeetings({ silent: true });
    };
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    const pollId = setInterval(() => fetchMeetings({ silent: true }), 5000);

    return () => {
      unsubscribe();
      clearInterval(pollId);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [refreshKey]);

  const activeCount = meetings.filter(isActiveMeeting).length;

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h3 className="font-outfit font-bold text-base text-slate-900 flex items-center gap-2">
            <img src="/revora-icon.png" alt="Revora" className="w-4 h-4 object-contain" />
            Meeting Monitor
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Bot status, transcripts, recordings, summaries, and action items.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200/80 text-[10px] font-mono font-semibold text-slate-600">
            {meetings.length} total · {activeCount} active
          </span>
          <button
            onClick={fetchMeetings}
            disabled={loading}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-500 transition-colors cursor-pointer"
            title="Refresh meetings"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#0084FF]' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-3">
        {meetings.length > 0 ? (
          meetings.map((m) => (
            <div
              key={m.id}
              className="p-4 rounded-xl bg-slate-50/70 border border-slate-200/80 hover:bg-sky-50/30 hover:border-sky-200/80 transition-all space-y-2"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-bold text-sm text-slate-900 truncate">
                      {m.title || 'Live Video Meeting'}
                    </h4>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono border ${meetingStageClasses(m)}`}
                    >
                      {meetingStageLabel(m)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 font-mono truncate">
                    Bot ID: <span className="font-bold text-slate-700">{m.bot_id || '—'}</span> • {m.meeting_url}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
                    <Users className="w-3 h-3 text-slate-400" />
                    Visible to: <span className="font-bold text-slate-700">{ownerLabel(m.user_id)}</span>
                  </p>
                  {(m.clients?.name || m.projects?.clients?.name || m.projects?.name) && (
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {(m.clients?.name || m.projects?.clients?.name) && (
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold flex items-center gap-1 border border-slate-200/60">
                          <Building2 className="w-2.5 h-2.5 text-[#0084FF]" />
                          <span>{m.clients?.name || m.projects?.clients?.name}</span>
                        </span>
                      )}
                      {m.projects?.name && (
                        <span className="px-2 py-0.5 rounded-md bg-sky-50 text-[#0084FF] text-[10px] font-semibold flex items-center gap-1 border border-sky-100">
                          <FolderGit2 className="w-2.5 h-2.5 text-[#0084FF]" />
                          <span>{m.projects.name}</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className="text-slate-400 font-mono">
                    {new Date(m.created_at).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <button
                    onClick={() => setSelected(m)}
                    className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-sky-50 border border-slate-200/90 font-bold text-[#0084FF] shadow-2xs transition-colors cursor-pointer"
                  >
                    View Results →
                  </button>
                </div>
              </div>

              {m.error_message && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
                  <span>{m.error_message}</span>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="p-8 rounded-2xl bg-slate-50/60 border border-slate-200/80 text-center space-y-2">
            <Clock className={`w-8 h-8 text-[#0084FF] mx-auto ${loading ? 'animate-pulse' : ''}`} />
            <h4 className="font-outfit font-bold text-base text-slate-900">
              {loading ? 'Loading meetings…' : 'No meetings yet'}
            </h4>
            <p className="text-xs text-slate-500 max-w-[480px] mx-auto leading-relaxed">
              Deploy the Revora bot into a Google Meet, Zoom, or Teams call above. Status, transcript, summary, and
              action items land here automatically once the call ends.
            </p>
          </div>
        )}
      </div>

      {/* Meeting Details Modal (Light Mode) */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-[680px] w-full p-5 space-y-4 border border-slate-200 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
              <div className="min-w-0">
                <h3 className="font-outfit font-bold text-xl text-slate-900 truncate">
                  {selected.title || 'Meeting Results'}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                  Bot ID: {selected.bot_id || '—'} • {selected.meeting_url}
                </p>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Stage: {meetingStageLabel(selected)} • Visible to: {ownerLabel(selected.user_id)}
                </p>
                {(selected.clients?.name || selected.projects?.clients?.name || selected.projects?.name) && (
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {(selected.clients?.name || selected.projects?.clients?.name) && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold flex items-center gap-1 border border-slate-200/60">
                        <Building2 className="w-2.5 h-2.5 text-[#0084FF]" />
                        <span>Client: {selected.clients?.name || selected.projects?.clients?.name}</span>
                      </span>
                    )}
                    {selected.projects?.name && (
                      <span className="px-2 py-0.5 rounded-md bg-sky-50 text-[#0084FF] text-[10px] font-semibold flex items-center gap-1 border border-sky-100">
                        <FolderGit2 className="w-2.5 h-2.5 text-[#0084FF]" />
                        <span>Project: {selected.projects.name}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 cursor-pointer shrink-0 transition-colors"
              >
                Close
              </button>
            </div>

             <MeetingProjectAssignment key={selected.id} meeting={selected} onAssigned={(updated) => {
               setSelected(updated);
               setMeetings((current) => current.map((m) => m.id === updated.id ? updated : m));
             }} />
              <ContextBriefingSection key={`${selected.id}:${selected.project_id || ''}`} meeting={selected} />
              {linkedPlannedMeeting && <section className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Pre-meeting briefing</h4>
                <ContextBriefingSection key={`planned:${linkedPlannedMeeting.id}`} plannedMeeting={linkedPlannedMeeting} readOnly />
              </section>}

               {(selected.bot_id || selected.recording_url) && <MeetingRecordingLink key={selected.id} meeting={selected} />}

            {selected.summary && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Executive Summary</h4>
                <div className="p-4 rounded-2xl bg-sky-50/50 border border-sky-100 text-xs text-slate-800 leading-relaxed font-sans">
                  {selected.summary}
                </div>
              </div>
            )}

            {selected.transcript && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Full Transcript</h4>
                  <span className="text-[11px] font-mono text-slate-500">
                    {transcriptParagraphs(selected).length} dialogue turns •{' '}
                    {selected.transcript.length} characters
                  </span>
                </div>
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-800 font-mono whitespace-pre-wrap leading-relaxed max-h-[320px] overflow-y-auto shadow-inner">
                  {transcriptDisplayText(selected)}
                </div>
              </div>
            )}

            {Array.isArray(selected.action_items) && selected.action_items.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Action Items</h4>
                <div className="space-y-2">
                  {selected.action_items.map((item, idx) => (
                    <ActionItemCard key={idx} item={item} />
                  ))}
                </div>
              </div>
            )}

            {selected.error_message && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <span>{selected.error_message}</span>
              </div>
            )}

            {!selected.summary &&
              !selected.transcript &&
              !selected.error_message &&
              !(Array.isArray(selected.action_items) && selected.action_items.length > 0) && (
                <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500">
                  <Clock className="w-4 h-4 shrink-0 text-[#0084FF]" />
                  <span>
                    No results yet. Transcript, summary, and action items appear here automatically once the meeting
                    ends and post-processing completes.
                  </span>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
