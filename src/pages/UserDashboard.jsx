import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import BriefingCard from '../components/BriefingCard';
import TaskExtractorModal from '../components/TaskExtractorModal';
import { Bot, LogOut, Mic, FileText, CheckSquare, Sparkles, ArrowLeft } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function UserDashboard({ onNavigateHome, onOpenTryModal }) {
  const { user, logout } = useAuth();
  const [micActive, setMicActive] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  const sampleTranscripts = [
    { id: 1, title: 'Q3 Front-End Architecture Review', date: 'Today, 2:30 PM', duration: '34 mins', summary: 'Approved liquid glass UI components and sub-50ms streaming targets.' },
    { id: 2, title: 'Sprint Backlog & Task Estimation', date: 'Yesterday, 11:00 AM', duration: '45 mins', summary: 'Assigned top engineering tasks and verified database SQLite sync.' },
    { id: 3, title: 'Product Design System Alignment', date: 'Aug 2, 2026', duration: '20 mins', summary: 'Standardized typography across Outfit, Fustat, and Inter fonts.' },
  ];

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
              onClick={() => setIsTaskModalOpen(true)}
              className="mt-6 py-2.5 px-4 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Extract Action Items</span>
            </button>
          </div>

        </div>

        {/* Transcripts History */}
        <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-4 border-b border-black/5">
            <div>
              <h3 className="font-outfit font-bold text-lg text-black">Recent Meeting Transcripts</h3>
              <p className="text-xs text-black/50">Access past meeting recordings and AI-generated insights</p>
            </div>
            <span className="px-3 py-1 rounded-full bg-black/5 text-xs font-bold text-black/70">
              3 Transcripts
            </span>
          </div>

          <div className="space-y-3">
            {sampleTranscripts.map((t) => (
              <div key={t.id} className="p-4 rounded-2xl bg-neutral-50 hover:bg-sky-50/50 border border-black/5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="font-bold text-sm text-black flex items-center gap-2">
                    {t.title}
                    <span className="text-[10px] font-mono font-normal text-black/40">({t.duration})</span>
                  </h4>
                  <p className="text-xs text-black/60">{t.summary}</p>
                </div>

                <div className="flex items-center gap-3 text-xs shrink-0">
                  <span className="text-black/40 font-mono">{t.date}</span>
                  <button onClick={onOpenTryModal} className="px-3 py-1.5 rounded-xl bg-white border border-black/10 font-bold text-[#0084FF] hover:underline cursor-pointer">
                    Open Transcript →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </main>

      {/* Task Extractor Modal */}
      <TaskExtractorModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
      />
    </div>
  );
}