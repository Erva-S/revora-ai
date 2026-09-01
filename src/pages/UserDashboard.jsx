import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import BriefingCard from '../components/BriefingCard';
import MeetingBotDeployer from '../components/MeetingBotDeployer';
import ActionItemCard, { readActionItem } from '../components/ActionItemCard';
import { meetingStageLabel, meetingStageClasses } from '../lib/meetingStatus';
import { Bot, LogOut, Mic, FileText, CheckSquare, Sparkles, ArrowLeft, RefreshCw, CheckCircle2, Clock, AlertCircle, Video, ExternalLink } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function UserDashboard({ onNavigateHome, onOpenTryModal }) {
  const { user, logout } = useAuth();
  const [micActive, setMicActive] = useState(false);
  const [meetingsList, setMeetingsList] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState(null);

  // Fetch real meetings from Supabase Postgres database
  const fetchMeetings = async () => {
    try {
      setLoadingMeetings(true);
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setMeetingsList(data);
      }
    } catch (err) {
      console.warn('Meetings query notice:', err);
    } finally {
      setLoadingMeetings(false);
    }
  };

  useEffect(() => {
    fetchMeetings();

    let channel = null;
    try {
      channel = supabase
        .channel('meetings_realtime_feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => {
          fetchMeetings();
        })
        .subscribe();
    } catch (realtimeErr) {
      console.warn('Realtime subscription notice:', realtimeErr);
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (_) {}
      }
    };
  }, []);

  const handleTestMic = () => {
    setMicActive(!micActive);
    if (!micActive) {
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.7 } });
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-black/5 px-6 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-4">
          <button
            onClick={onNavigateHome}
            className="p-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/70 hover:text-black transition-colors cursor-pointer"
            title="Return to Landing Page"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="font-fustat font-extrabold text-[20px] text-black flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-white border border-black/10 shadow-2xs flex items-center shrink-0" title="CHARUSAT">
              <img src="/college-logo.png" alt="CHARUSAT Logo" className="h-6 w-auto object-contain" />
            </div>
            <div className="h-4 w-[1px] bg-black/15 shrink-0 hidden sm:block" />
            <div className="w-7 h-7 rounded-lg bg-[#0084FF] flex items-center justify-center text-white shrink-0">
              <Bot className="w-4 h-4" />
            </div>
            <span>Revora Dashboard</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0084FF] uppercase">
              User Portal
            </span>
          </div>
        </div>

        {/* Logged in User Badge & Logout */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-neutral-100 border border-black/5">
            <img
              src={user?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face'}
              alt="User Avatar"
              className="w-7 h-7 rounded-full object-cover border border-white"
            />
            <div className="hidden sm:flex flex-col text-left leading-tight">
              <span className="font-bold text-xs text-black">{user?.name || 'Standard User'}</span>
              <span className="text-[10px] text-black/50">{user?.email}</span>
            </div>
          </div>

          <button
            onClick={logout}
            className="px-3.5 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
        
        {/* Welcome Hero Card */}
        <div className="p-8 rounded-[28px] bg-gradient-to-br from-[#0084FF] to-[#0066CC] text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
          <div className="relative z-10 max-w-[600px]">
            <span className="px-3 py-1 rounded-full bg-white/20 text-xs font-bold uppercase tracking-wider">
              Authenticated Session • Role: {user?.role || 'user'}
            </span>
            <h1 className="font-outfit font-black text-[30px] sm:text-[36px] leading-tight mt-3">
              Welcome back, {user?.name || 'User'}!
            </h1>
            <p className="font-sans text-sm text-white/80 mt-2 leading-relaxed">
              Your Revora AI assistant is active and ready to transcribe streams, summarize PDFs, and extract tasks.
            </p>
          </div>

          <button
            onClick={onOpenTryModal}
            className="relative z-10 px-6 py-3.5 rounded-2xl bg-white text-[#0084FF] font-bold text-sm hover:bg-sky-50 transition-all hover:scale-105 shadow-lg cursor-pointer shrink-0 flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4 text-[#0084FF]" />
            <span>Launch Revora Assistant</span>
          </button>

          {/* Backdrop ambient blur circle */}
          <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
        </div>

        {/* Meeting Bot Deployer Component */}
        <MeetingBotDeployer />

        {/* Live Pre-Meeting Briefing Feed */}
        <section>
          <BriefingCard meetingId={1} />
        </section>

        {/* Quick Tools Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Tool 1 */}
          <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-2xl bg-sky-100 text-[#0084FF] flex items-center justify-center mb-4">
                <Mic className="w-5 h-5" />
              </div>
              <h3 className="font-outfit font-bold text-lg text-black mb-1">Live Audio Stream</h3>
              <p className="text-xs text-black/60 leading-relaxed">
                Connect your microphone or video call stream for sub-50ms real-time speech transcription.
              </p>
            </div>
            <button
              onClick={handleTestMic}
              className={`mt-6 py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
                micActive ? 'bg-red-500 text-white animate-pulse' : 'bg-sky-50 hover:bg-sky-100 text-[#0084FF]'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              <span>{micActive ? 'Streaming Live Audio...' : 'Test Mic Transcriber'}</span>
            </button>
          </div>

          {/* Tool 2 */}
          <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
                <FileText className="w-5 h-5" />
              </div>
              <h3 className="font-outfit font-bold text-lg text-black mb-1">Smart Summarizer</h3>
              <p className="text-xs text-black/60 leading-relaxed">
                Upload meeting notes, raw transcripts, or PDFs to extract 3-minute executive summaries.
              </p>
            </div>
            <button
              onClick={onOpenTryModal}
              className="mt-6 py-2.5 px-4 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Generate Summary</span>
            </button>
          </div>

          {/* Tool 3 */}
          <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center mb-4">
                <CheckSquare className="w-5 h-5" />
              </div>
              <h3 className="font-outfit font-bold text-lg text-black mb-1">Task Extractor</h3>
              <p className="text-xs text-black/60 leading-relaxed">
                Automatically convert spoken commitments into structured Jira and Slack action items.
              </p>
            </div>
            <button
              onClick={onOpenTryModal}
              className="mt-6 py-2.5 px-4 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>View Action Items</span>
            </button>
          </div>

        </div>

        {/* Real-time Transcripts & AI Summaries Feed */}
        <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-black/5">
            <div>
              <h3 className="font-outfit font-bold text-lg text-black">Live Meeting Summaries & Transcripts</h3>
              <p className="text-xs text-black/50">Real-time feed connected to Supabase & MeetingBaaS</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchMeetings}
                disabled={loadingMeetings}
                className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-xs font-bold text-black/70 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingMeetings ? 'animate-spin' : ''}`} />
                <span>Refresh Feed</span>
              </button>
              <span className="px-3 py-1 rounded-full bg-sky-100 text-[#0084FF] text-xs font-bold font-mono">
                {meetingsList.length} Meetings Recorded
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {meetingsList.length > 0 ? (
              meetingsList.map((m) => (
                <div
                  key={m.id}
                  className="p-5 rounded-2xl bg-neutral-50 hover:bg-sky-50/50 border border-black/5 transition-all space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-black/5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-black">
                          {m.title || 'Live Video Meeting'}
                        </h4>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono border ${meetingStageClasses(m)}`}>
                          {meetingStageLabel(m)}
                        </span>
                      </div>
                      <p className="text-xs text-black/50 font-mono">
                        Bot ID: <span className="font-bold text-black/70">{m.bot_id}</span> • {m.meeting_url}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 text-xs shrink-0">
                      <span className="text-black/40 font-mono">
                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <button
                        onClick={() => setSelectedMeeting(m)}
                        className="px-3.5 py-1.5 rounded-xl bg-white border border-black/10 font-bold text-[#0084FF] hover:bg-sky-50 transition-colors cursor-pointer"
                      >
                        View AI Summary & Tasks →
                      </button>
                    </div>
                  </div>

                  {m.summary && (
                    <div className="p-3.5 rounded-xl bg-white border border-black/5 text-xs text-black/80 leading-relaxed">
                      <strong className="text-[#0084FF] font-bold">Executive Summary: </strong>
                      {m.summary}
                    </div>
                  )}

                  {Array.isArray(m.action_items) && m.action_items.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {m.action_items.map((item, idx) => {
                        const parsed = readActionItem(item);
                        if (!parsed) return null;
                        return (
                          <span
                            key={idx}
                            className="px-3 py-1 rounded-lg bg-purple-50 text-purple-700 border border-purple-100 text-[11px] font-semibold flex items-center gap-1.5"
                          >
                            <CheckSquare className="w-3 h-3 text-purple-500" />
                            <span>{parsed.task}</span>
                            {parsed.assignee && (
                              <span className="text-purple-500 font-medium">· {parsed.assignee}</span>
                            )}
                            {parsed.due && <span className="text-purple-500 font-medium">· {parsed.due}</span>}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            ) : (
              /* Fallback structured sample list if database has no rows yet */
              <div className="p-6 rounded-2xl bg-neutral-50 text-center space-y-2">
                <Clock className="w-8 h-8 text-[#0084FF] mx-auto animate-pulse" />
                <h4 className="font-outfit font-bold text-base text-black">Awaiting Your First Meeting Bot</h4>
                <p className="text-xs text-black/60 max-w-[480px] mx-auto leading-relaxed">
                  Enter a Google Meet, Zoom, or Teams URL above and click <strong>Deploy Bot</strong>. As soon as the call ends, your Gemini AI summary will land right here automatically!
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Selected Meeting Details Modal */}
        {selectedMeeting && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-[28px] max-w-[640px] w-full p-6 space-y-5 border border-black/10 shadow-2xl relative max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-4 border-b border-black/5">
                <div>
                  <h3 className="font-outfit font-bold text-xl text-black">
                    {selectedMeeting.title || 'Meeting Summary & AI Insights'}
                  </h3>
                  <p className="text-xs text-black/50 font-mono mt-0.5">
                    Bot ID: {selectedMeeting.bot_id} • {selectedMeeting.meeting_url}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedMeeting(null)}
                  className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-xs font-bold text-black/70 cursor-pointer"
                >
                  Close
                </button>
              </div>

              {selectedMeeting.recording_url && (
                <a
                  href={selectedMeeting.recording_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3.5 rounded-2xl bg-[#0084FF]/5 border border-[#0084FF]/20 hover:bg-[#0084FF]/10 transition-colors group"
                >
                  <span className="flex items-center gap-2.5 text-sm font-bold text-[#0084FF]">
                    <Video className="w-4 h-4" />
                    Watch Meeting Recording
                  </span>
                  <ExternalLink className="w-4 h-4 text-[#0084FF]/70 group-hover:text-[#0084FF]" />
                </a>
              )}

              {selectedMeeting.summary && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-black uppercase tracking-wider">Executive Summary</h4>
                  <div className="p-4 rounded-2xl bg-sky-50/50 border border-sky-100 text-xs text-black/90 leading-relaxed font-sans">
                    {selectedMeeting.summary}
                  </div>
                </div>
              )}

              {selectedMeeting.transcript && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-black uppercase tracking-wider">Full Transcript</h4>
                    <span className="text-[11px] font-mono text-black/50">
                      {selectedMeeting.transcript.split('\n').filter(Boolean).length} dialogue turns • {selectedMeeting.transcript.length} characters
                    </span>
                  </div>
                  <div className="p-4 rounded-2xl bg-neutral-50 border border-black/5 text-xs text-black/80 font-mono whitespace-pre-wrap leading-relaxed max-h-[350px] overflow-y-auto shadow-inner">
                    {selectedMeeting.transcript}
                  </div>
                </div>
              )}

              {Array.isArray(selectedMeeting.action_items) && selectedMeeting.action_items.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-black uppercase tracking-wider">Assigned Action Items</h4>
                  <div className="space-y-2">
                    {selectedMeeting.action_items.map((item, idx) => (
                      <ActionItemCard key={idx} item={item} />
                    ))}
                  </div>
                </div>
              )}

              {selectedMeeting.error_message && (
                <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-800 leading-relaxed">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>{selectedMeeting.error_message}</span>
                </div>
              )}

              {!selectedMeeting.summary &&
                !selectedMeeting.transcript &&
                !selectedMeeting.error_message &&
                !(Array.isArray(selectedMeeting.action_items) && selectedMeeting.action_items.length > 0) && (
                  <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-neutral-50 border border-black/5 text-xs text-black/60">
                    <Clock className="w-4 h-4 shrink-0 text-[#0084FF]" />
                    <span>
                      No AI insights yet. Summary, transcript, and action items appear here automatically once the meeting
                      ends and processing completes.
                    </span>
                  </div>
                )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}