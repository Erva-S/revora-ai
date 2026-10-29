import React, { useEffect, useState } from 'react';
import {
  X, Calendar, Clock, Video, Users, Building2, FolderGit2,
  ExternalLink, Copy, Check, AlertCircle, RefreshCw, Loader2,
  Mail, Sparkles, FileText, CheckCircle2, Globe, ShieldCheck, Bell
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import ActionItemCard from './ActionItemCard';
import ContextBriefingSection from './ContextBriefingSection';
import MeetingRecordingLink from './MeetingRecordingLink';
import { meetingStageLabel, meetingStageClasses } from '../lib/meetingStatus';
import { transcriptDisplayText, transcriptParagraphs } from '../lib/transcriptDisplay';
import { subscribeToMeetingChanges } from '../lib/meetingRealtime';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

/**
 * Platform detector from meeting URL
 */
function getMeetingPlatform(url) {
  if (!url || typeof url !== 'string') return null;
  const lower = url.toLowerCase();
  if (lower.includes('meet.google.com')) {
    return { name: 'Google Meet', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  if (lower.includes('zoom.us')) {
    return { name: 'Zoom Meeting', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) {
    return { name: 'Microsoft Teams', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
  }
  if (lower.includes('webex.com')) {
    return { name: 'Cisco Webex', badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200' };
  }
  if (/^https?:\/\//i.test(url)) {
    return { name: 'Video Call', badgeClass: 'bg-sky-50 text-[#0084FF] border-sky-200' };
  }
  return null;
}

/**
 * Validates external URL safely
 */
function isValidUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    const parsed = new URL(str.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Formats time with local timezone name and offset
 */
function formatMeetingDateTime(dateObj) {
  if (!dateObj || !(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
    return { dateStr: 'Date to be announced', timeStr: 'TBD', timeZoneStr: '' };
  }

  const dateStr = dateObj.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeStr = dateObj.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Calculate local timezone info
  const timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMinutes = -dateObj.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const gmtString = `GMT${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMins).padStart(2, '0')}`;
  const timeZoneStr = `${timeZoneName} (${gmtString})`;

  return { dateStr, timeStr, timeZoneStr };
}

export default function MeetingDetailsModal({ meeting, onClose, currentUser, onMeetingUpdated }) {
  const [activeMeeting, setActiveMeeting] = useState(meeting || {});
  const [linkedPlannedMeeting, setLinkedPlannedMeeting] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [reminderSending, setReminderSending] = useState(false);
  const [reminderSentState, setReminderSentState] = useState(
    Boolean(meeting?.reminderSent || meeting?.reminder_sent || meeting?.raw?.reminderSent || meeting?.raw?.reminder_sent)
  );
  const [emailStatus, setEmailStatus] = useState(null);
  const [errorNotice, setErrorNotice] = useState(null);

  const rawItem = meeting?.raw || meeting || {};

  // Extract core fields across raw types (meetings table, planned_meetings, or briefings)
  const supabaseMeetingId = (activeMeeting.bot_id || activeMeeting.created_at || rawItem.bot_id) ? (activeMeeting.id || rawItem.id) : (activeMeeting.linked_meeting_id || rawItem.linked_meeting_id || null);

  const meetingUrl = 
    activeMeeting.meeting_url || 
    activeMeeting.meetingUrl || 
    rawItem.meeting_url || 
    rawItem.meetingUrl || 
    null;

  const title = 
    activeMeeting.title || 
    rawItem.title || 
    'Meeting Details';

  const agenda = 
    activeMeeting.agenda || 
    activeMeeting.description || 
    activeMeeting.details || 
    activeMeeting.summaryContext || 
    rawItem.agenda || 
    rawItem.description || 
    '';

  const clientName = 
    activeMeeting.clientName || 
    activeMeeting.client_name || 
    activeMeeting.clients?.name || 
    activeMeeting.projects?.clients?.name || 
    rawItem.clientName || 
    rawItem.client_name || 
    rawItem.clients?.name || 
    null;

  const projectName = 
    activeMeeting.projectName || 
    activeMeeting.project_name || 
    activeMeeting.projects?.name || 
    rawItem.projectName || 
    rawItem.project_name || 
    rawItem.projects?.name || 
    null;

  const rawAttendees = 
    activeMeeting.recipientEmail || 
    activeMeeting.recipient_email || 
    activeMeeting.attendees || 
    rawItem.recipientEmail || 
    rawItem.recipient_email || 
    rawItem.attendees;

  const attendeeList = rawAttendees
    ? (Array.isArray(rawAttendees) ? rawAttendees : String(rawAttendees).split(',').map((e) => e.trim()).filter(Boolean))
    : [];

  const creatorEmail = 
    activeMeeting.creatorEmail || 
    activeMeeting.creator_email || 
    rawItem.creatorEmail || 
    rawItem.creator_email || 
    null;

  // Derive Held/Scheduled Date
  const heldDate = (() => {
    if (meeting?.date instanceof Date) return meeting.date;
    const rawDate = 
      activeMeeting.scheduled_for || 
      activeMeeting.scheduledFor || 
      activeMeeting.scheduledAt || 
      activeMeeting.scheduled_at || 
      activeMeeting.started_at || 
      activeMeeting.startedAt || 
      activeMeeting.created_at || 
      activeMeeting.createdAt || 
      rawItem.scheduled_for || 
      rawItem.scheduledAt;
    if (rawDate) {
      const parsed = new Date(rawDate);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  })();

  const { dateStr, timeStr, timeZoneStr } = formatMeetingDateTime(heldDate);
  const platform = getMeetingPlatform(meetingUrl);
  const validUrl = isValidUrl(meetingUrl);

  // Status & Lifecycle checks
  const isCompleted = 
    activeMeeting.status === 'completed' || 
    activeMeeting.status === 'summarized' || 
    activeMeeting.processing_stage === 'completed';

  const isTranscriptProcessing = 
    activeMeeting.processing_stage === 'transcript_processing';

  const isSummaryProcessing = 
    activeMeeting.processing_stage === 'summary_processing';

  const isRecording = 
    activeMeeting.status === 'recording' || 
    activeMeeting.processing_stage === 'meeting_in_progress';

  const isFailed = 
    activeMeeting.status === 'failed' || 
    activeMeeting.processing_stage === 'processing_failed' || 
    Boolean(activeMeeting.error_message);

  // Fetch full details from Supabase if linked to a meetings table record
  const syncSupabaseMeeting = async () => {
    if (!supabaseMeetingId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('meetings')
        .select('*, projects(id, name, clients(id, name)), clients(id, name)')
        .eq('id', supabaseMeetingId)
        .maybeSingle();

      if (!error && data) {
        setActiveMeeting((prev) => ({ ...prev, ...data }));
        if (onMeetingUpdated) onMeetingUpdated(data);
      }
    } catch (err) {
      console.warn('[MeetingDetailsModal] Supabase query notice:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch full details from Express SQLite if it is a briefing
  const syncBriefingMeeting = async () => {
    const briefingId = activeMeeting.id || rawItem.id;
    if (!briefingId || typeof briefingId !== 'number' && isNaN(Number(briefingId))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/briefings/${briefingId}`, {
        headers: {
          'x-user-email': currentUser?.email || '',
          'x-user-id': currentUser?.id || '',
          'x-user-role': currentUser?.role || 'user',
          'x-client-id': currentUser?.clientId || currentUser?.client_id || '',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setActiveMeeting((prev) => ({ ...prev, ...data }));
        if (data.reminderSent || data.reminder_sent) {
          setReminderSentState(true);
        }
        if (onMeetingUpdated) onMeetingUpdated(data);
      }
    } catch (err) {
      console.warn('[MeetingDetailsModal] Briefing fetch notice:', err);
    }
  };

  useEffect(() => {
    setActiveMeeting(meeting || {});
    if (supabaseMeetingId) {
      syncSupabaseMeeting();
    } else {
      syncBriefingMeeting();
    }

    // Lookup linked planned meeting if any
    let cancelled = false;
    if (supabaseMeetingId) {
      supabase
        .from('planned_meetings')
        .select('*')
        .eq('linked_meeting_id', supabaseMeetingId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (!cancelled && !error) setLinkedPlannedMeeting(data || null);
        });
    }

    // Subscribe to realtime updates for this meeting
    let unsubscribe = null;
    if (supabaseMeetingId) {
      unsubscribe = subscribeToMeetingChanges(`meeting_modal_${supabaseMeetingId}`, {
        filter: `id=eq.${supabaseMeetingId}`,
        onChange: (payload) => {
          if (payload?.new) {
            setActiveMeeting((prev) => ({ ...prev, ...payload.new }));
            if (onMeetingUpdated) onMeetingUpdated(payload.new);
          }
        },
      });
    }

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [meeting?.id, supabaseMeetingId]);

  const handleCopyLink = () => {
    if (!meetingUrl) return;
    navigator.clipboard.writeText(meetingUrl.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenLink = () => {
    if (!validUrl) return;
    window.open(meetingUrl.trim(), '_blank', 'noopener,noreferrer');
  };

  const handleDispatchResultsEmail = async () => {
    const bId = activeMeeting.id || rawItem.id;
    if (!bId) return;

    try {
      setEmailSending(true);
      setErrorNotice(null);
      setEmailStatus(null);

      const res = await fetch(`${API_BASE_URL}/api/briefings/${bId}/results-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': currentUser?.email || '',
          'x-user-id': currentUser?.id || '',
          'x-user-role': currentUser?.role || 'user',
          'x-client-id': currentUser?.clientId || currentUser?.client_id || '',
        },
        body: JSON.stringify({
          summary: activeMeeting.summary || agenda || '',
          actionItems: activeMeeting.action_items || activeMeeting.actionItems || [],
          transcriptSnippet: activeMeeting.transcript ? activeMeeting.transcript.slice(0, 450) + '...' : '',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch results email');
      }

      setEmailStatus({
        success: true,
        message: 'Post-meeting summary email dispatched successfully to attendees!',
        previewUrl: data.emailStatus?.previewUrl || null,
      });
    } catch (err) {
      console.error('[MeetingDetailsModal] Email dispatch error:', err);
      setErrorNotice(err.message || 'Error sending post-meeting email.');
    } finally {
      setEmailSending(false);
    }
  };

  const handleDispatchReminderEmail = async () => {
    const bId = activeMeeting.id || rawItem.id;
    if (!bId) return;

    try {
      setReminderSending(true);
      setErrorNotice(null);
      setEmailStatus(null);

      const res = await fetch(`${API_BASE_URL}/api/briefings/${bId}/reminder-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': currentUser?.email || '',
          'x-user-id': currentUser?.id || '',
          'x-user-role': currentUser?.role || 'user',
          'x-client-id': currentUser?.clientId || currentUser?.client_id || '',
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dispatch reminder email');
      }

      setReminderSentState(true);
      setEmailStatus({
        success: true,
        message: 'Day-of meeting reminder email dispatched successfully to attendees!',
        previewUrl: data.emailStatus?.previewUrl || null,
      });
    } catch (err) {
      console.error('[MeetingDetailsModal] Reminder dispatch error:', err);
      setErrorNotice(err.message || 'Error sending reminder email.');
    } finally {
      setReminderSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs font-sans">
      <div className="bg-white rounded-[28px] max-w-[720px] w-full p-6 space-y-5 border border-slate-200/90 shadow-2xl relative max-h-[88vh] overflow-y-auto">
        
        {/* MODAL HEADER */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <img src="/revora-icon.png" alt="Revora" className="w-5 h-5 object-contain shrink-0" />
              <h3 className="font-outfit font-bold text-xl text-slate-900 truncate">
                {title}
              </h3>
            </div>

            <div className="flex items-center gap-2 flex-wrap text-xs">
              {/* Lifecycle Stage / Status Badge */}
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono border ${meetingStageClasses(activeMeeting)}`}>
                {meetingStageLabel(activeMeeting)}
              </span>

              {/* Platform Badge */}
              {platform && (
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono border ${platform.badgeClass}`}>
                  {platform.name}
                </span>
              )}

              {/* Bot ID indicator if applicable */}
              {activeMeeting.bot_id && (
                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-mono">
                  Bot: <span className="font-bold">{activeMeeting.bot_id}</span>
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                if (supabaseMeetingId) syncSupabaseMeeting();
                else syncBriefingMeeting();
              }}
              disabled={loading}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-600 transition-colors cursor-pointer"
              title="Refresh meeting details"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#0084FF]' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* DATE, TIME & TIMEZONE */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50/70 border border-slate-200/80 text-xs text-slate-700">
          <div className="flex items-start gap-2.5">
            <Calendar className="w-4 h-4 text-[#0084FF] shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900">{dateStr}</p>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5">Scheduled Meeting Date</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-[#0084FF] shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-slate-900">{timeStr}</p>
              <p className="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-1">
                <Globe className="w-3 h-3 text-slate-400" />
                <span>{timeZoneStr}</span>
              </p>
            </div>
          </div>
        </div>

        {/* MEETING LINK & JOIN ACTION */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5 text-[#0084FF]" />
              {isCompleted ? 'Original Meeting Link' : 'Meeting Platform & Link'}
            </span>
            {platform && (
              <span className="text-[11px] font-semibold text-slate-600 font-mono">
                {platform.name}
              </span>
            )}
          </div>

          {validUrl ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-200 text-xs font-mono text-slate-700 break-all select-all shadow-2xs">
                <span className="truncate flex-1">{meetingUrl}</span>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                  title="Copy link"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-3">
                {!isCompleted ? (
                  <button
                    type="button"
                    onClick={handleOpenLink}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Join Meeting Now</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleOpenLink}
                    className="py-2 px-4 rounded-xl bg-white hover:bg-slate-100 border border-slate-200/90 text-slate-700 font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                    <span>Open Original Meeting Link</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-white border border-slate-200/80 text-xs text-slate-500 text-center font-medium">
              No video meeting URL provided for this session.
            </div>
          )}
        </div>

        {/* ORGANIZER, CLIENT & ATTENDEES */}
        <div className="space-y-3">
          {(clientName || projectName || creatorEmail) && (
            <div className="flex items-center gap-2 flex-wrap">
              {clientName && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-semibold flex items-center gap-1.5 border border-slate-200/60">
                  <Building2 className="w-3.5 h-3.5 text-[#0084FF]" />
                  <span>Client: {clientName}</span>
                </span>
              )}
              {projectName && (
                <span className="px-2.5 py-1 rounded-lg bg-sky-50 text-[#0084FF] text-xs font-semibold flex items-center gap-1.5 border border-sky-100">
                  <FolderGit2 className="w-3.5 h-3.5 text-[#0084FF]" />
                  <span>Project: {projectName}</span>
                </span>
              )}
              {creatorEmail && (
                <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-mono flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>Organizer: {creatorEmail}</span>
                </span>
              )}
            </div>
          )}

          {attendeeList.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#0084FF]" />
                Attendees ({attendeeList.length})
              </h4>
              <div className="flex items-center gap-1.5 flex-wrap">
                {attendeeList.map((email, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700 flex items-center gap-1.5"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#0084FF]" />
                    <span>{email}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* CONTEXT BRIEFING / AGENDA */}
        {agenda && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#0084FF]" />
              Meeting Context & Agenda
            </h4>
            <div className="p-3.5 rounded-2xl bg-neutral-50 border border-slate-200/80 text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-wrap">
              {agenda}
            </div>
          </div>
        )}

        {/* Pre-meeting briefing component integration */}
        {supabaseMeetingId && (
          <ContextBriefingSection key={`${supabaseMeetingId}:${activeMeeting.project_id || ''}`} meeting={activeMeeting} />
        )}
        {linkedPlannedMeeting && (
          <section className="space-y-2">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Pre-meeting briefing</h4>
            <ContextBriefingSection key={`planned:${linkedPlannedMeeting.id}`} plannedMeeting={linkedPlannedMeeting} readOnly />
          </section>
        )}

        {/* BOT & RECORDING ACCESS */}
        {(activeMeeting.bot_id || activeMeeting.recording_url) && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Call Recording</h4>
            <MeetingRecordingLink key={activeMeeting.id} meeting={activeMeeting} />
          </div>
        )}

        {/* POST-MEETING PROCESSING STATES */}
        {isRecording && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3 text-emerald-800 text-xs font-medium">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping shrink-0" />
            <div>
              <p className="font-bold text-emerald-800">Meeting In Progress</p>
              <p className="text-[11px] text-emerald-700">The Revora meeting assistant is actively in call and capturing audio.</p>
            </div>
          </div>
        )}

        {isTranscriptProcessing && (
          <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 flex items-center gap-3 text-sky-900 text-xs font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-[#0084FF] shrink-0" />
            <div>
              <p className="font-bold text-[#0084FF]">Audio Transcribing in Progress</p>
              <p className="text-[11px] text-sky-800/80">ElevenLabs speech recognition is converting meeting audio into speaker-diarized text. The transcript will appear here automatically.</p>
            </div>
          </div>
        )}

        {isSummaryProcessing && (
          <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center gap-3 text-indigo-900 text-xs font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
            <div>
              <p className="font-bold text-indigo-700">AI Summary & Action Items Processing</p>
              <p className="text-[11px] text-indigo-800/80">Gemini AI is analyzing conversation context to extract key takeaways, decisions, and tasks.</p>
            </div>
          </div>
        )}

        {isFailed && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 leading-relaxed">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <div>
              <p className="font-bold text-red-900">Processing Failed</p>
              <p className="text-[11px] text-red-700">{activeMeeting.error_message || 'The meeting recording or transcription encountered an error.'}</p>
            </div>
          </div>
        )}

        {/* POST-MEETING EXECUTIVE SUMMARY */}
        {activeMeeting.summary && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#0084FF]" />
              AI Executive Summary
            </h4>
            <div className="p-4 rounded-2xl bg-sky-50/50 border border-sky-100 text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-line shadow-2xs">
              {activeMeeting.summary}
            </div>
          </div>
        )}

        {/* POST-MEETING TRANSCRIPT */}
        {activeMeeting.transcript && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#0084FF]" />
                Full Diarized Transcript
              </h4>
              <span className="text-[11px] font-mono text-slate-500">
                {transcriptParagraphs(activeMeeting).length} dialogue turns • {activeMeeting.transcript.length} characters
              </span>
            </div>
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-800 font-mono whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto shadow-inner">
              {transcriptDisplayText(activeMeeting)}
            </div>
          </div>
        )}

        {/* POST-MEETING ACTION ITEMS */}
        {Array.isArray(activeMeeting.action_items || activeMeeting.actionItems) && 
         (activeMeeting.action_items || activeMeeting.actionItems).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Action Items & Decisions
            </h4>
            <div className="space-y-2">
              {(activeMeeting.action_items || activeMeeting.actionItems).map((item, idx) => (
                <ActionItemCard key={idx} item={item} />
              ))}
            </div>
          </div>
        )}

        {/* AUTOMATED EMAIL REMINDER & NOTIFICATIONS */}
        {!isCompleted && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                  <Mail className="w-3.5 h-3.5 text-[#0084FF]" />
                  <span>Automated Email Notifications</span>
                </div>
                <p className="text-[11px] text-slate-500 font-mono">
                  Scheduling confirmation sent &bull; Day-of reminder {reminderSentState ? 'dispatched' : 'scheduled'}
                </p>
              </div>

              {reminderSentState ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Day-of Reminder Sent
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleDispatchReminderEmail}
                  disabled={reminderSending}
                  className="px-3.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-[#0084FF] font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 border border-blue-200/60"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>{reminderSending ? 'Dispatching Reminder…' : 'Send Day-of Reminder'}</span>
                </button>
              )}
            </div>

            {emailStatus && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{emailStatus.message}</span>
                </span>
                {emailStatus.previewUrl && (
                  <a
                    href={emailStatus.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-[#0084FF] underline shrink-0"
                  >
                    View Ethereal Preview &rarr;
                  </a>
                )}
              </div>
            )}

            {errorNotice && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorNotice}</span>
              </div>
            )}
          </div>
        )}

        {/* DISPATCH RESULTS EMAIL ACTION */}
        {(activeMeeting.summary || isCompleted) && (
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-[11px] text-slate-500 font-mono">
                {activeMeeting.resultsEmailSent ? 'Results email already sent to attendees.' : 'Email attendees with summary & action items.'}
              </p>
              <button
                type="button"
                onClick={handleDispatchResultsEmail}
                disabled={emailSending}
                className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Mail className="w-3.5 h-3.5 text-[#0084FF]" />
                <span>{emailSending ? 'Dispatching Email…' : 'Send Summary Email'}</span>
              </button>
            </div>

            {emailStatus && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{emailStatus.message}</span>
                </span>
                {emailStatus.previewUrl && (
                  <a
                    href={emailStatus.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-[#0084FF] underline shrink-0"
                  >
                    View Ethereal Preview &rarr;
                  </a>
                )}
              </div>
            )}

            {errorNotice && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorNotice}</span>
              </div>
            )}
          </div>
        )}

        {/* EMPTY STATE */}
        {!activeMeeting.summary &&
          !activeMeeting.transcript &&
          !isRecording &&
          !isTranscriptProcessing &&
          !isSummaryProcessing &&
          !isFailed &&
          !(Array.isArray(activeMeeting.action_items) && activeMeeting.action_items.length > 0) && (
            <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-slate-500">
              <Clock className="w-4 h-4 shrink-0 text-[#0084FF]" />
              <span>
                Meeting results (transcript, AI summary, action items, and recording) will appear here automatically once the meeting concludes and post-processing completes.
              </span>
            </div>
          )}

        {/* MODAL FOOTER */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
          <span className="text-[11px] text-slate-400 font-mono">
            Revora AI Meeting Assistant
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}
