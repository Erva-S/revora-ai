import React, { useEffect, useState } from 'react';
import { Bot, Video, Loader2, CheckCircle2, AlertCircle, Sparkles, RefreshCw, ExternalLink, ChevronDown, ChevronRight, Circle } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function MeetingBotDeployer({ onBotDeployed, assignableUsers }) {
  const [meetingUrl, setMeetingUrl] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [assignToUserId, setAssignToUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState([]);
  const [projectsAvailable, setProjectsAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [botStatus, setBotStatus] = useState(null); // null | { botId, status, meetingUrl, deployedAt }
  const [showDetails, setShowDetails] = useState(false);

  const loadProjects = async () => {
    try {
      const { data, error: projectError } = await supabase.from('projects').select('id,name,clients(name)').order('name');
      if (!projectError) { setProjects(data || []); setProjectsAvailable(true); }
    } catch { /* Optional context deployment may not be installed yet. */ }
  };
  useEffect(() => { const timer = setTimeout(loadProjects, 0); return () => clearTimeout(timer); }, []);

  useEffect(() => {
    if (!botStatus?.botId) return undefined;

    let cancelled = false;

    const syncBotState = async () => {
      try {
        const { data, error: syncError } = await supabase
          .from('meetings')
          .select('status,error_message,summary,ended_at,updated_at')
          .eq('bot_id', botStatus.botId)
          .maybeSingle();

        if (cancelled || syncError || !data) return;

        setBotStatus((current) => {
          if (!current || current.botId !== botStatus.botId) return current;
          const nextStatus = data.status || current.status;
          return {
            ...current,
            status: nextStatus,
            errorMessage: data.error_message || null,
            summary: data.summary || current.summary || null,
            endedAt: data.ended_at || current.endedAt || null,
            updatedAt: data.updated_at || current.updatedAt || null,
          };
        });

        if (data.status === 'failed' && data.error_message) {
          setError(data.error_message);
        }
      } catch (syncErr) {
        console.warn('Meeting status sync notice:', syncErr);
      }
    };

    // Initial fetch
    syncBotState();

    // Primary: Supabase Realtime — fires within ~1s of a DB change.
    let channel = null;
    try {
      channel = supabase
        .channel(`deployer_bot_${botStatus.botId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'meetings', filter: `bot_id=eq.${botStatus.botId}` },
          () => { if (!cancelled) syncBotState(); }
        )
        .subscribe();
    } catch (realtimeErr) {
      console.warn('MeetingBotDeployer realtime subscription notice:', realtimeErr);
    }

    // Fallback: relaxed 15s poll in case Realtime channel drops.
    const intervalId = setInterval(syncBotState, 15000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (channel) {
        try { supabase.removeChannel(channel); } catch (_) {}
      }
    };
  }, [botStatus?.botId]);

  const detectPlatform = (url) => {
    if (!url) return null;
    if (url.includes('zoom.us')) return { name: 'Zoom', color: 'text-blue-600' };
    if (url.includes('meet.google.com')) return { name: 'Google Meet', color: 'text-emerald-600' };
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return { name: 'Microsoft Teams', color: 'text-purple-600' };
    return { name: 'Video Call', color: 'text-sky-600' };
  };

  /** Extract a short meeting code from the URL for compact display. */
  const meetingCode = (url) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes('meet.google.com')) return u.pathname.replace(/^\//, '');
      if (u.hostname.includes('zoom.us')) {
        const match = u.pathname.match(/\/j\/(\d+)/);
        return match ? match[1] : u.pathname.replace(/^\//, '');
      }
      return u.hostname + u.pathname;
    } catch { return url; }
  };

  const platform = detectPlatform(meetingUrl);

  const handleDeployBot = async (e) => {
    e.preventDefault();
    if (!meetingUrl.trim()) {
      setError('Please enter a valid Zoom, Google Meet, or Microsoft Teams URL.');
      return;
    }

    try {
      new URL(meetingUrl);
    } catch (_) {
      setError('Please enter a valid URL (starting with http:// or https://)');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Invoke Supabase Edge Function 'deploy-bot'. The function re-verifies the
      // caller's admin role server-side; assign_to_user_id only decides which
      // user is allowed to read the results afterwards.
      const { data, error: funcError } = await supabase.functions.invoke('deploy-bot', {
        body: {
          meetingUrl: meetingUrl.trim(),
          ...(meetingTitle.trim() ? { title: meetingTitle.trim() } : {}),
          ...(assignToUserId ? { assign_to_user_id: assignToUserId } : {}),
          ...(projectId ? { project_id: projectId } : {}),
        },
      });

      if (funcError) {
        let detail = funcError.message;
        try {
          if (typeof funcError.context?.json === 'function') {
            const errCtx = await funcError.context.json();
            if (errCtx?.error) detail = errCtx.error;
          }
        } catch (_) {}
        console.error('Edge Function invoke returned error:', funcError, detail);
        throw new Error(detail || 'Edge Function execution failed.');
      }

      if (data?.success === false || data?.error) {
        console.error('Edge Function returned failure response:', data);
        throw new Error(data.error || 'Failed to dispatch bot.');
      }

      const botId = data?.bot_id || data?.id;
      if (!botId) {
        throw new Error('Server returned an invalid bot response (missing bot_id).');
      }

      const newBotState = {
        botId,
        status: data?.status || 'pending',
        meetingUrl: meetingUrl.trim(),
        botName: data?.bot_name || 'Revora Assistant',
        recordingMode: data?.recording_mode || 'speaker_view',
        assignedTo: data?.assigned_to || null,
        deployedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        errorMessage: null,
        summary: null,
        endedAt: null,
        updatedAt: null,
      };

      setBotStatus(newBotState);
      if (onBotDeployed) {
        onBotDeployed(newBotState);
      }
    } catch (err) {
      console.error('Failed to deploy MeetingBaaS bot:', err);
      setError(err.message || 'Failed to deploy meeting bot. Please check your connection and configuration.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setBotStatus(null);
    setMeetingUrl('');
    setMeetingTitle('');
    setProjectId('');
    setError(null);
    setShowDetails(false);
  };

  const handleEjectBot = async () => {
    if (!botStatus?.botId) return;
    if (!window.confirm('Force the bot to leave the meeting immediately? This will end recording and trigger post-processing.')) return;
    try {
      setLoading(true);
      setBotStatus((current) => (current ? { ...current, status: 'leaving' } : null));
      await supabase.functions.invoke(`deploy-bot?bot_id=${botStatus.botId}`, {
        method: 'DELETE',
      });
    } catch (ejectErr) {
      console.warn('Eject bot notice:', ejectErr);
    } finally {
      setLoading(false);
    }
  };

  // ── Deploy Form (no active bot) ───────────────────────────────────
  if (!botStatus) {
    return (
      <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs font-sans">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-4">
          <div className="w-8 h-8 rounded-xl bg-[#0084FF] flex items-center justify-center text-white shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-outfit font-bold text-base text-slate-900">Deploy Meeting Bot</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Send Revora into a live meeting for transcription, summarisation, and action-item extraction.
            </p>
          </div>
        </div>

        <form onSubmit={handleDeployBot} className="space-y-3">
          <div>
            <label htmlFor="meeting-url-input" className="block text-[11px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
              Meeting URL
            </label>
            <div className="relative">
              <input
                id="meeting-url-input"
                type="url"
                value={meetingUrl}
                onChange={(e) => { setMeetingUrl(e.target.value); if (error) setError(null); }}
                placeholder="https://meet.google.com/... or https://zoom.us/j/..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-[#0084FF] focus:bg-white focus:ring-2 focus:ring-[#0084FF]/10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                disabled={loading}
              />
              {platform && (
                <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${platform.color}`}>
                  {platform.name}
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="meeting-title-input" className="block text-[11px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
                Title <span className="font-normal text-slate-400 normal-case">(optional)</span>
              </label>
              <input
                id="meeting-title-input"
                type="text"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="Weekly Engineering Sync"
                maxLength={200}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-[#0084FF] focus:bg-white focus:ring-2 focus:ring-[#0084FF]/10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                disabled={loading}
              />
            </div>

            {Array.isArray(assignableUsers) && assignableUsers.length > 0 && (
              <div>
                <label htmlFor="meeting-owner-select" className="block text-[11px] font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">
                  Assign To <span className="font-normal text-slate-400 normal-case">(defaults to you)</span>
                </label>
                <select
                  id="meeting-owner-select"
                  value={assignToUserId}
                  onChange={(e) => setAssignToUserId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-[#0084FF] focus:bg-white focus:ring-2 focus:ring-[#0084FF]/10 text-sm text-slate-900 outline-none transition-all cursor-pointer"
                  disabled={loading}
                >
                  <option value="">Keep for admins only</option>
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name || u.email} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {projectsAvailable && <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
            Project <span className="font-normal text-slate-400 normal-case">(optional)</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} onFocus={loadProjects} disabled={loading}
              className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 outline-none font-normal normal-case">
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.clients?.name} / {p.name}</option>)}
            </select>
          </label>}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-medium flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end pt-1">
            <button
              type="submit"
              disabled={loading || !meetingUrl.trim()}
              className="px-5 py-2.5 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm flex items-center gap-2 shadow-xs hover:shadow-sm transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Deploying...</span>
                </>
              ) : (
                <>
                  <Bot className="w-4 h-4" />
                  <span>Deploy Bot</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // ── Active Bot State ──────────────────────────────────────────────
  const status = botStatus.status;
  const summary = botStatus.summary;
  const isDone = status === 'summarized' || status === 'completed';
  const isFailed = status === 'failed';
  const isLeaving = status === 'leaving';
  const isRecording = status === 'recording' || status === 'in_call';
  const isActive = !isDone && !isFailed;
  const activePlatform = detectPlatform(botStatus.meetingUrl);

  // Pipeline steps derived from existing application logic
  const steps = [
    { label: 'Dispatched', done: true, active: !isRecording && !isLeaving && !isDone && !isFailed },
    { label: isRecording ? 'Recording' : 'In Meeting', done: isRecording || isLeaving || isDone, active: isRecording },
    { label: 'Processing', done: isDone, active: isLeaving },
    { label: 'Complete', done: isDone && !!summary, active: isDone },
  ];
  if (isFailed) {
    steps.forEach((s, i) => { if (!s.done) { s.failed = i <= 1; } });
  }

  // Status badge
  let statusLabel = 'Pending';
  let statusColor = 'bg-amber-50 text-amber-700 border-amber-200';
  if (isRecording) { statusLabel = 'Recording'; statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-200'; }
  else if (isLeaving) { statusLabel = 'Processing'; statusColor = 'bg-sky-50 text-[#0084FF] border-sky-200'; }
  else if (isDone) { statusLabel = 'Completed'; statusColor = 'bg-emerald-50 text-emerald-700 border-emerald-200'; }
  else if (isFailed) { statusLabel = 'Failed'; statusColor = 'bg-red-50 text-red-700 border-red-200'; }

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs font-sans space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-xl bg-[#0084FF] text-white flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            {isActive && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-outfit font-bold text-base text-slate-900 truncate">Revora Assistant</h3>
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border shrink-0 ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              Deployed at {botStatus.deployedAt}
            </p>
          </div>
        </div>

        <button
          onClick={handleReset}
          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-[11px] font-semibold text-slate-600 transition-colors cursor-pointer shrink-0"
        >
          New Deployment
        </button>
      </div>

      {/* Meeting Info */}
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <Video className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="min-w-0">
            <span className={`text-[11px] font-semibold ${activePlatform?.color || 'text-slate-600'}`}>
              {activePlatform?.name || 'Video Call'}
            </span>
            <p className="text-xs font-mono text-slate-700 truncate">{meetingCode(botStatus.meetingUrl)}</p>
          </div>
        </div>
        <a
          href={botStatus.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg hover:bg-slate-200/80 text-slate-400 hover:text-[#0084FF] transition-colors shrink-0"
          title="Open meeting"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Pipeline Stepper */}
      <div className="px-1">
        <div className="flex items-center">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            let dotClass = 'w-2.5 h-2.5 rounded-full border-2 shrink-0 ';
            let labelClass = 'text-[11px] font-medium mt-1 whitespace-nowrap ';
            let lineClass = 'flex-1 h-[2px] mx-1.5 shrink-0 ';

            if (step.done || step.active) {
              dotClass += step.failed
                ? 'bg-red-500 border-red-500'
                : 'bg-[#0084FF] border-[#0084FF]';
              labelClass += step.failed ? 'text-red-600 font-semibold' : 'text-slate-900 font-semibold';
            } else {
              dotClass += 'bg-white border-slate-300';
              labelClass += 'text-slate-400';
            }

            if (step.active && !step.failed) {
              dotClass += ' ring-4 ring-[#0084FF]/20';
            }

            const lineFilled = steps[i + 1]?.done || steps[i + 1]?.active;

            return (
              <React.Fragment key={i}>
                <div className="flex flex-col items-center">
                  <div className={dotClass} />
                  <span className={labelClass}>{step.label}</span>
                </div>
                {!isLast && (
                  <div className={lineClass + (lineFilled ? 'bg-[#0084FF]' : 'bg-slate-200')} style={{ marginBottom: '1.25rem' }} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Error */}
      {botStatus.errorMessage && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{botStatus.errorMessage}</span>
        </div>
      )}

      {/* Summary Preview */}
      {summary && (
        <div className="p-3.5 rounded-xl bg-emerald-50/60 border border-emerald-200/80 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
            <Sparkles className="w-3.5 h-3.5" />
            <span>AI Summary</span>
          </div>
          <p className="text-xs text-slate-800 leading-relaxed">{summary}</p>
        </div>
      )}

      {/* Technical Details (collapsible) */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer w-fit"
      >
        {showDetails ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>Deployment details</span>
      </button>

      {showDetails && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <span className="text-slate-500 block mb-0.5">Bot ID</span>
            <span className="font-mono font-semibold text-slate-700 break-all">{botStatus.botId}</span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <span className="text-slate-500 block mb-0.5">Recording</span>
            <span className="font-semibold text-slate-700 capitalize">{botStatus.recordingMode}</span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80">
            <span className="text-slate-500 block mb-0.5">Status</span>
            <span className="font-semibold text-slate-700 capitalize">{status}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      {isActive && (
        <div className="pt-2 border-t border-slate-100 flex items-center justify-end">
          <button
            onClick={handleEjectBot}
            disabled={loading || isLeaving}
            className="px-3 py-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            <AlertCircle className="w-3 h-3" />
            <span>{isLeaving ? 'Leaving...' : 'Force Leave'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
