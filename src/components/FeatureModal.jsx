import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Mic,
  FileText,
  Users,
  CheckSquare,
  Calendar,
  Bell,
  Search,
  BarChart3,
  Sparkles,
  Play,
  Pause,
  Download,
  Copy,
  Check,
  Plus,
  Send,
  Clock,
  UserCheck,
  TrendingUp,
  Share2,
} from 'lucide-react';
import confetti from 'canvas-confetti';

export default function FeatureModal({ isOpen, onClose, activeFeatureId = 'transcription' }) {
  const [currentTab, setCurrentTab] = useState(activeFeatureId);
  const [isRecording, setIsRecording] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tasks, setTasks] = useState([
    { id: 1, text: 'Review Q3 Front-End Architecture Spec', assignee: 'Sarah C.', done: true, priority: 'High' },
    { id: 2, text: 'Finalize liquid-glass component design tokens', assignee: 'Alex R.', done: false, priority: 'High' },
    { id: 3, text: 'Deploy sub-50ms streaming endpoint to staging', assignee: 'David K.', done: false, priority: 'Medium' },
  ]);

  useEffect(() => {
    if (activeFeatureId) {
      setCurrentTab(activeFeatureId);
    }
  }, [activeFeatureId]);

  if (!isOpen) return null;

  const featuresList = [
    { id: 'transcription', title: 'Live Transcription', icon: Mic, color: 'from-[#0084FF] to-[#0066CC]' },
    { id: 'summary', title: 'AI Meeting Summary', icon: FileText, color: 'from-[#10B981] to-[#059669]' },
    { id: 'speaker', title: 'Speaker Identification', icon: Users, color: 'from-[#9333EA] to-[#7E22CE]' },
    { id: 'actions', title: 'Action Items', icon: CheckSquare, color: 'from-[#F59E0B] to-[#D97706]' },
    { id: 'calendar', title: 'Calendar Sync', icon: Calendar, color: 'from-[#EF4444] to-[#DC2626]' },
    { id: 'remind', title: 'Smart Reminders', icon: Bell, color: 'from-[#EC4899] to-[#DB2777]' },
    { id: 'search', title: 'AI Search', icon: Search, color: 'from-[#0284C7] to-[#0369A1]' },
    { id: 'analytics', title: 'Meeting Analytics', icon: BarChart3, color: 'from-[#7C3AED] to-[#6D28D9]' },
  ];

  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleTask = (id) => {
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleTriggerSuccess = () => {
    confetti({
      particleCount: 40,
      spread: 60,
      origin: { y: 0.6 },
      colors: ['#0084FF', '#10B981', '#9333EA', '#EF4444'],
    });
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-hidden">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/50 backdrop-blur-md"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 220 }}
          className="relative w-full max-w-[880px] h-[85vh] max-h-[720px] bg-white/95 backdrop-blur-[35px] border border-white/80 rounded-[28px] shadow-2xl flex flex-col z-10 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-black/5 bg-white/60">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#0084FF]/10 flex items-center justify-center text-[#0084FF]">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-outfit font-bold text-[18px] text-black">
                  Assist Feature Interactive Showcase
                </h3>
                <p className="font-sans text-[12px] text-black/50">
                  Explore and test all 8 AI meeting intelligence features live
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-black/60 hover:text-black transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Horizontal Feature Tab Bar */}
          <div className="px-4 py-3 bg-neutral-100/70 border-b border-black/5 flex gap-2 overflow-x-auto no-scrollbar">
            {featuresList.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === currentTab;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
                    isActive
                      ? 'bg-white text-black shadow-sm ring-1 ring-black/10 scale-102'
                      : 'text-black/60 hover:text-black hover:bg-white/50'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-md bg-gradient-to-br ${item.color} flex items-center justify-center text-white`}>
                    <Icon className="w-2.5 h-2.5" />
                  </div>
                  <span>{item.title}</span>
                </button>
              );
            })}
          </div>

          {/* Modal Tab Content Area */}
          <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-b from-white to-neutral-50/50">
            
            {/* 1. LIVE TRANSCRIPTION TAB */}
            {currentTab === 'transcription' && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-[20px] bg-sky-50/60 border border-sky-100">
                  <div>
                    <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                      <Mic className="w-5 h-5 text-[#0084FF]" />
                      Real-Time Audio Stream Transcription
                    </h4>
                    <p className="font-sans text-xs text-black/60 mt-1">
                      Converts speech to text instantly with sub-50ms latency and 99.4% accuracy.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsRecording(!isRecording)}
                    className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 text-white shadow-md transition-all cursor-pointer ${
                      isRecording ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-[#0084FF] hover:bg-[#0074E0]'
                    }`}
                  >
                    {isRecording ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    <span>{isRecording ? 'Stop Transcribing' : 'Start Live Mic Demo'}</span>
                  </button>
                </div>

                <div className="p-5 rounded-[20px] bg-white border border-black/10 shadow-xs space-y-3 font-sans text-xs">
                  <div className="flex items-center justify-between text-black/40 font-mono text-[11px] pb-2 border-b border-black/5">
                    <span>STATUS: {isRecording ? '● RECORDING & STREAMING' : 'READY TO STREAM'}</span>
                    <span>1080p AUDIO • 48 kHz</span>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div className="flex items-start gap-3">
                      <span className="font-bold text-[#0084FF] shrink-0 font-mono">[00:12] Alex:</span>
                      <p className="text-neutral-800 leading-relaxed">
                        "Let's review the new liquid-glass architecture update for the Assist landing page..."
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="font-bold text-emerald-600 shrink-0 font-mono">[00:24] Sarah:</span>
                      <p className="text-neutral-800 leading-relaxed">
                        "The responsiveness looks crisp across 12-column grids and mobile viewport drawer breakpoints."
                      </p>
                    </div>
                    {isRecording && (
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-start gap-3 text-purple-600 font-medium"
                      >
                        <span className="font-bold shrink-0 font-mono">[Live Stream]:</span>
                        <p className="animate-pulse">"Transcribing live audio input into text..."</p>
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 2. AI MEETING SUMMARY TAB */}
            {currentTab === 'summary' && (
              <div className="space-y-6">
                <div className="p-5 rounded-[20px] bg-emerald-50/60 border border-emerald-100 flex items-center justify-between">
                  <div>
                    <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                      <FileText className="w-5 h-5 text-emerald-600" />
                      Automated Executive Summaries
                    </h4>
                    <p className="font-sans text-xs text-black/60 mt-1">
                      Synthesizes hour-long meetings into 3-minute executive briefings.
                    </p>
                  </div>
                  <button
                    onClick={handleTriggerSuccess}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Export PDF
                  </button>
                </div>

                <div className="p-5 rounded-[20px] bg-white border border-black/10 shadow-xs space-y-4 font-sans text-xs">
                  <div>
                    <span className="font-bold text-black uppercase tracking-wider text-[11px] text-emerald-700">Executive Summary</span>
                    <p className="mt-2 text-neutral-800 leading-relaxed">
                      The product engineering team aligned on the Q3 roadmap strategy, confirming zero-latency streaming execution and liquid glass UI principles for the Assist platform.
                    </p>
                  </div>

                  <div className="pt-3 border-t border-black/5 space-y-2">
                    <span className="font-bold text-black text-[11px]">Key Decisions:</span>
                    <ul className="list-disc list-inside space-y-1 text-neutral-700">
                      <li>Approved sub-50ms token generation latency targets for enterprise tier.</li>
                      <li>Standardized design system tokens with Outfit, Fustat, and Inter typography.</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* 3. SPEAKER IDENTIFICATION TAB */}
            {currentTab === 'speaker' && (
              <div className="space-y-6">
                <div className="p-5 rounded-[20px] bg-purple-50/60 border border-purple-100">
                  <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-600" />
                    Biometric Voice Diarization & Speaker Stats
                  </h4>
                  <p className="font-sans text-xs text-black/60 mt-1">
                    Identifies distinct voices and measures individual talk-time ratios.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { name: 'Alex Rivera (Lead)', talkTime: '42%', minutes: '18m 40s', color: 'bg-[#0084FF]' },
                    { name: 'Sarah Chen (UI/UX)', talkTime: '35%', minutes: '15m 10s', color: 'bg-emerald-500' },
                    { name: 'David Kim (Backend)', talkTime: '23%', minutes: '10m 05s', color: 'bg-purple-600' },
                  ].map((s, i) => (
                    <div key={i} className="p-4 rounded-[18px] bg-white border border-black/10 shadow-xs space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-black">{s.name}</span>
                        <span className="font-mono text-black/50">{s.talkTime}</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-neutral-100 overflow-hidden">
                        <div className={`h-full ${s.color}`} style={{ width: s.talkTime }} />
                      </div>
                      <div className="text-[11px] text-black/50 font-mono">{s.minutes} talk duration</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. ACTION ITEMS TAB */}
            {currentTab === 'actions' && (
              <div className="space-y-6">
                <div className="p-5 rounded-[20px] bg-amber-50/60 border border-amber-100 flex items-center justify-between">
                  <div>
                    <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                      <CheckSquare className="w-5 h-5 text-amber-600" />
                      Automated Task Extraction & Assignment
                    </h4>
                    <p className="font-sans text-xs text-black/60 mt-1">
                      Identifies actionable commitments from meeting speech automatically.
                    </p>
                  </div>
                  <button
                    onClick={handleTriggerSuccess}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-md cursor-pointer"
                  >
                    Sync to Jira & Slack
                  </button>
                </div>

                <div className="p-4 rounded-[20px] bg-white border border-black/10 shadow-xs space-y-3">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => handleToggleTask(task.id)}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                        task.done ? 'bg-neutral-50 border-black/5 line-through opacity-70' : 'bg-white border-black/10 hover:border-[#0084FF]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${task.done ? 'bg-amber-500 border-amber-500 text-white' : 'border-black/30'}`}>
                          {task.done && <Check className="w-3.5 h-3.5" />}
                        </div>
                        <span className="font-sans text-xs font-semibold text-neutral-800">{task.text}</span>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-black/5 text-black/60 font-mono">
                        {task.assignee}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. CALENDAR SYNC TAB */}
            {currentTab === 'calendar' && (
              <div className="space-y-6">
                <div className="p-5 rounded-[20px] bg-red-50/60 border border-red-100">
                  <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-red-600" />
                    Instant Calendar & Event Scheduler
                  </h4>
                  <p className="font-sans text-xs text-black/60 mt-1">
                    Detects proposed meeting dates in conversations and creates calendar invites.
                  </p>
                </div>

                <div className="p-5 rounded-[20px] bg-white border border-black/10 shadow-xs space-y-4 text-xs font-sans">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="font-bold text-black mb-1 block">Event Title</label>
                      <input type="text" readOnly value="Q3 Product Roadmap Review" className="w-full px-3 py-2 rounded-xl bg-neutral-100 border border-black/10" />
                    </div>
                    <div>
                      <label className="font-bold text-black mb-1 block">Date & Time</label>
                      <input type="text" readOnly value="Tomorrow • 10:00 AM PST (30 min)" className="w-full px-3 py-2 rounded-xl bg-neutral-100 border border-black/10" />
                    </div>
                  </div>
                  <button
                    onClick={handleTriggerSuccess}
                    className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold shadow-md cursor-pointer"
                  >
                    Schedule & Send Google / Outlook Invites
                  </button>
                </div>
              </div>
            )}

            {/* 6. SMART REMIND TAB */}
            {currentTab === 'remind' && (
              <div className="space-y-6">
                <div className="p-5 rounded-[20px] bg-pink-50/60 border border-pink-100">
                  <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                    <Bell className="w-5 h-5 text-pink-600" />
                    Contextual Smart Reminders & Alerts
                  </h4>
                  <p className="font-sans text-xs text-black/60 mt-1">
                    Pings you on Slack or Email before key deadlines approach.
                  </p>
                </div>

                <div className="p-4 rounded-[20px] bg-white border border-black/10 shadow-xs space-y-3 text-xs font-sans">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-neutral-50 border border-black/5">
                    <div className="flex items-center gap-2.5">
                      <Clock className="w-4 h-4 text-pink-600" />
                      <span className="font-bold text-black">Slack Ping 15 mins before Q3 Architecture Sync</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-green-100 text-green-700 text-[10px] font-bold">Active</span>
                  </div>
                </div>
              </div>
            )}

            {/* 7. AI SEARCH TAB */}
            {currentTab === 'search' && (
              <div className="space-y-6">
                <div className="p-5 rounded-[20px] bg-sky-50/60 border border-sky-100">
                  <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                    <Search className="w-5 h-5 text-sky-600" />
                    Semantic Meeting Search Engine
                  </h4>
                  <p className="font-sans text-xs text-black/60 mt-1">
                    Search across all past transcripts, decisions, and documents instantly.
                  </p>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 absolute left-4 top-3.5 text-black/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search past meetings, decisions or quotes (e.g. 'liquid glass architecture')..."
                    className="w-full pl-10 pr-4 py-3 rounded-2xl bg-white border border-black/10 text-xs font-sans focus:outline-none focus:border-sky-500 shadow-xs"
                  />
                </div>

                <div className="p-4 rounded-[20px] bg-white border border-black/10 shadow-xs text-xs font-sans space-y-2">
                  <div className="text-[11px] font-bold text-sky-700">Matched Result (Q3 Roadmap Meeting):</div>
                  <p className="text-neutral-800">"...agreed to standardize on liquid-glass squircle cards and sub-50ms streaming..."</p>
                </div>
              </div>
            )}

            {/* 8. MEETING ANALYTICS TAB */}
            {currentTab === 'analytics' && (
              <div className="space-y-6">
                <div className="p-5 rounded-[20px] bg-violet-50/60 border border-violet-100">
                  <h4 className="font-outfit font-bold text-base text-black flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-violet-600" />
                    AI-Powered Meeting Health & Efficiency Analytics
                  </h4>
                  <p className="font-sans text-xs text-black/60 mt-1">
                    Metrics on engagement, sentiment, and decision productivity.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-sans">
                  <div className="p-4 rounded-[18px] bg-white border border-black/10 shadow-xs">
                    <div className="text-black/50 text-[11px]">Meeting Health Score</div>
                    <div className="text-2xl font-black text-violet-700 font-outfit mt-1">96 / 100</div>
                    <div className="text-[10px] text-green-600 font-semibold mt-1">↑ 4.2% from last week</div>
                  </div>
                  <div className="p-4 rounded-[18px] bg-white border border-black/10 shadow-xs">
                    <div className="text-black/50 text-[11px]">Overall Sentiment</div>
                    <div className="text-2xl font-black text-emerald-600 font-outfit mt-1">Positive</div>
                    <div className="text-[10px] text-black/40 font-mono mt-1">98.2% Constructive</div>
                  </div>
                  <div className="p-4 rounded-[18px] bg-white border border-black/10 shadow-xs">
                    <div className="text-black/50 text-[11px]">Decisions Per Hour</div>
                    <div className="text-2xl font-black text-[#0084FF] font-outfit mt-1">8.4 / hr</div>
                    <div className="text-[10px] text-black/40 font-mono mt-1">High Velocity</div>
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Footer bar */}
          <div className="px-6 py-4 bg-white border-t border-black/5 flex items-center justify-between">
            <span className="text-xs text-black/50 font-sans">
              All 8 meeting intelligence modules active
            </span>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-black hover:bg-neutral-800 text-white font-bold text-xs transition-all cursor-pointer"
            >
              Done Exploring
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
