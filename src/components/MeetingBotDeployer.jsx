import React, { useEffect, useState } from 'react';
import { Bot, Video, ArrowRight, Loader2, CheckCircle2, AlertCircle, Sparkles, RefreshCw, Zap } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function MeetingBotDeployer({ onBotDeployed, assignableUsers }) {
  const [meetingUrl, setMeetingUrl] = useState('');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [assignToUserId, setAssignToUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [botStatus, setBotStatus] = useState(null); // null | { botId, status, meetingUrl, deployedAt }

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
    if (url.includes('zoom.us')) return { name: 'Zoom', color: 'bg-blue-500 text-white' };
    if (url.includes('meet.google.com')) return { name: 'Google Meet', color: 'bg-emerald-500 text-white' };
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return { name: 'Microsoft Teams', color: 'bg-purple-600 text-white' };
    return { name: 'Video Call', color: 'bg-sky-500 text-white' };
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
    setError(null);
  };

  const handleEjectBot = async () => {
    if (!botStatus?.botId) return;
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

  return (
    <div className="p-6 sm:p-8 rounded-[28px] bg-white border border-slate-200/80 shadow-xs relative overflow-hidden font-sans">
      {/* Decorative ambient background gradient */}
      <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-gradient-to-br from-[#0084FF]/10 to-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

      {/* Header Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#0084FF] to-[#0066CC] flex items-center justify-center text-white shadow-xs">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-outfit font-black text-xl text-slate-900 flex items-center gap-2">
              Revora AI Meeting Assistant
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0084FF] uppercase tracking-wider">
                Ready to Deploy
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Deploy Revora into a live meeting and let it capture the meeting for transcription, summarization, and action-item generation.
            </p>
          </div>
        </div>

        {botStatus && (
          <button
            onClick={handleReset}
            className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer w-fit"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Deploy Another Bot</span>
          </button>
        )}
      </div>

      {/* Form or Active Bot State */}
      <div className="mt-6">
        {!botStatus ? (
          <form onSubmit={handleDeployBot} className="space-y-4">
            <div>
              <label htmlFor="meeting-url-input" className="block text-xs font-bold text-slate-700 mb-2">
                Live Meeting URL
              </label>
              <div className="relative flex items-center">
                <div className="absolute left-3.5 text-slate-400 pointer-events-none">
                  <Video className="w-5 h-5" />
                </div>
                <input
                  id="meeting-url-input"
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => {
                    setMeetingUrl(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="https://meet.google.com/... or https://zoom.us/j/..."
                  className="w-full pl-11 pr-32 py-3.5 rounded-2xl bg-slate-50/70 border border-slate-200/90 focus:border-[#0084FF] focus:bg-white focus:ring-4 focus:ring-[#0084FF]/10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                  disabled={loading}
                />

                {platform && (
                  <div className="absolute right-3">
                    <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${platform.color} shadow-2xs`}>
                      {platform.name}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="meeting-title-input" className="block text-xs font-bold text-slate-700 mb-2">
                  Meeting Title <span className="font-medium text-slate-400">(optional)</span>
                </label>
                <input
                  id="meeting-title-input"
                  type="text"
                  value={meetingTitle}
                  onChange={(e) => setMeetingTitle(e.target.value)}
                  placeholder="Weekly Engineering Sync"
                  maxLength={200}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-50/70 border border-slate-200/90 focus:border-[#0084FF] focus:bg-white focus:ring-4 focus:ring-[#0084FF]/10 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition-all"
                  disabled={loading}
                />
              </div>

              {Array.isArray(assignableUsers) && assignableUsers.length > 0 && (
                <div>
                  <label htmlFor="meeting-owner-select" className="block text-xs font-bold text-slate-700 mb-2">
                    Give Access To <span className="font-medium text-slate-400">(defaults to you)</span>
                  </label>
                  <select
                    id="meeting-owner-select"
                    value={assignToUserId}
                    onChange={(e) => setAssignToUserId(e.target.value)}
                    className="w-full px-3.5 py-3 rounded-2xl bg-slate-50/70 border border-slate-200/90 focus:border-[#0084FF] focus:bg-white focus:ring-4 focus:ring-[#0084FF]/10 text-sm text-slate-900 outline-none transition-all cursor-pointer"
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

            {error && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Zap className="w-4 h-4 text-amber-500" />
                <span>MeetingBaaS Realtime Bot + Gemini 1.5 Intelligence</span>
              </div>

              <button
                type="submit"
                disabled={loading || !meetingUrl.trim()}
                className="px-6 py-3.5 rounded-2xl bg-[#0084FF] hover:bg-[#0074E0] disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-md hover:shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed shrink-0"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deploying Bot...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Deploy Bot →</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* Active Deployed Bot Success Card */
          <div className="p-6 rounded-[22px] bg-gradient-to-r from-sky-50 to-blue-50/80 border border-sky-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-sky-200/60">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-11 h-11 rounded-2xl bg-[#0084FF] text-white flex items-center justify-center shadow-md">
                    <Bot className="w-6 h-6 animate-bounce" />
                  </div>
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-outfit font-black text-lg text-black">
                      Revora Assistant Dispatch Status
                    </h4>
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-[#0084FF] border border-sky-300 capitalize">
                        {botStatus.status}
                    </span>
                  </div>
                  <p className="text-xs text-black/60 font-mono mt-0.5">
                    Bot ID: <span className="font-bold text-[#0084FF]">{botStatus.botId}</span> • Deployed at {botStatus.deployedAt}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className={`px-3 py-1.5 rounded-xl bg-white/90 border text-xs font-semibold flex items-center gap-1.5 shadow-2xs ${botStatus.status === 'failed' ? 'border-red-200 text-red-700' : 'border-sky-200 text-sky-800'}`}>
                  <CheckCircle2 className={`w-4 h-4 ${botStatus.status === 'failed' ? 'text-red-500' : 'text-emerald-500'}`} />
                  <span>
                    {botStatus.status === 'recording'
                      ? 'Recording'
                      : botStatus.status === 'leaving'
                      ? 'Leaving & Processing...'
                      : botStatus.status === 'summarized' || botStatus.status === 'completed'
                      ? 'Completed'
                      : botStatus.status === 'failed'
                      ? 'Failed'
                      : 'Dispatched'}
                  </span>
                </div>

                {botStatus.status !== 'summarized' && botStatus.status !== 'completed' && (
                  <button
                    onClick={handleEjectBot}
                    disabled={loading || botStatus.status === 'leaving'}
                    className="px-3.5 py-1.5 rounded-xl bg-red-50 hover:bg-red-100 disabled:bg-neutral-100 disabled:text-black/40 border border-red-200 text-red-600 text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{botStatus.status === 'leaving' ? 'Leaving Call...' : 'Force Bot to Leave Call'}</span>
                  </button>
                )}
              </div>
            </div>

            {botStatus.errorMessage && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{botStatus.errorMessage}</span>
              </div>
            )}

            {/* Meeting Details Card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3.5 rounded-xl bg-white/90 border border-sky-100 space-y-1 sm:col-span-2">
                <span className="text-black/50 font-bold text-[10px] uppercase">Meeting Destination</span>
                <p className="font-medium text-black truncate">{botStatus.meetingUrl}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-white/90 border border-sky-100 space-y-1">
                <span className="text-black/50 font-bold text-[10px] uppercase">Recording Mode</span>
                <p className="font-bold text-[#0084FF] capitalize">{botStatus.recordingMode}</p>
              </div>
            </div>

            {/* Dynamic Pipeline Status */}
            {(() => {
              const status = botStatus.status;
              const summary = botStatus.summary;
              const isDone = status === 'summarized' || status === 'completed';
              const isFailed = status === 'failed';
              const isLeaving = status === 'leaving';
              const isRecording = status === 'recording' || status === 'in_call';

              // Step 2 state & styling
              let step2Text = '2. Awaiting Join';
              let step2Style = 'bg-sky-100 text-[#0084FF] font-bold border border-sky-300 animate-pulse';
              let step2Icon = <Loader2 className="w-3 h-3 animate-spin" />;

              if (isRecording) {
                step2Text = '2. In Call & Recording';
                step2Style = 'bg-emerald-100 text-emerald-700 font-bold border border-emerald-300 animate-pulse';
                step2Icon = <Video className="w-3 h-3" />;
              } else if (isLeaving) {
                step2Text = '2. Leaving Call...';
                step2Style = 'bg-amber-100 text-amber-800 font-bold border border-amber-300 animate-pulse';
                step2Icon = <Loader2 className="w-3 h-3 animate-spin" />;
              } else if (isDone) {
                step2Text = '2. Call Ended';
                step2Style = 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200';
                step2Icon = <CheckCircle2 className="w-3 h-3 text-emerald-600" />;
              } else if (isFailed) {
                step2Text = '2. Call Interrupted';
                step2Style = 'bg-red-50 text-red-700 font-bold border border-red-200';
                step2Icon = <AlertCircle className="w-3 h-3 text-red-500" />;
              }

              // Step 3 state & styling
              let step3Text = '3. Gemini AI Summary';
              let step3Style = 'bg-neutral-100 text-black/50 border border-neutral-200';
              let step3Icon = null;

              if (isLeaving) {
                step3Text = '3. Processing AI Insights...';
                step3Style = 'bg-sky-100 text-[#0084FF] font-bold border border-sky-300 animate-pulse';
                step3Icon = <Loader2 className="w-3 h-3 animate-spin" />;
              } else if (isDone || summary) {
                step3Text = summary ? '3. AI Summary Ready' : '3. Complete Transcript Ready';
                step3Style = 'bg-emerald-50 text-emerald-700 font-bold border border-emerald-200';
                step3Icon = <CheckCircle2 className="w-3 h-3 text-emerald-600" />;
              } else if (isFailed) {
                step3Text = '3. AI Skipped';
                step3Style = 'bg-red-50 text-red-700 font-bold border border-red-200';
                step3Icon = <AlertCircle className="w-3 h-3 text-red-500" />;
              }

              // Header text
              let headerNote = 'Awaiting Bot Join & Recording';
              if (isRecording) headerNote = 'Active in Call — Recording Stream';
              else if (isLeaving) headerNote = 'Bot Left — Processing Webhook & Gemini AI...';
              else if (isDone) headerNote = 'Pipeline Complete! AI Summary Generated';
              else if (isFailed) headerNote = 'Pipeline Stopped (Bot Failure)';

              return (
                <div className="p-4 rounded-xl bg-white/90 border border-sky-100 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-black">
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${isDone ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-[#0084FF] animate-ping'}`} />
                      MeetingBaaS Pipeline Status
                    </span>
                    <span className="text-[#0084FF] font-mono text-[11px]">{headerNote}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px] text-center font-medium">
                    <div className="py-1.5 px-2 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>1. Bot Dispatched</span>
                    </div>

                    <div className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 ${step2Style}`}>
                      {step2Icon}
                      <span>{step2Text}</span>
                    </div>

                    <div className={`py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 ${step3Style}`}>
                      {step3Icon}
                      <span>{step3Text}</span>
                    </div>
                  </div>

                  {summary && (
                    <div className="p-3.5 rounded-xl bg-emerald-50/90 border border-emerald-200 text-xs text-emerald-950 space-y-1 mt-2">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                        <Sparkles className="w-4 h-4 text-emerald-600" />
                        <span>AI Executive Summary Preview</span>
                      </div>
                      <p className="leading-relaxed text-black/80 font-sans">{summary}</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
