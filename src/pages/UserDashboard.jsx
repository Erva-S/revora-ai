import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import BriefingCard from '../components/BriefingCard';
import ContextBriefingSection from '../components/ContextBriefingSection';
import MeetingRecordingLink from '../components/MeetingRecordingLink';
import TaskExtractorModal from '../components/TaskExtractorModal';
import AttendeePicker from '../components/AttendeePicker';
import MeetingCalendar from '../components/MeetingCalendar';
import ActionItemCard, { readActionItem } from '../components/ActionItemCard';
import { meetingStageLabel, meetingStageClasses } from '../lib/meetingStatus';
import { transcriptDisplayText, transcriptParagraphs } from '../lib/transcriptDisplay';
import { applyMeetingChange, mergeMeetingRows, subscribeToMeetingChanges } from '../lib/meetingRealtime';
import { 
  LogOut, Mic, FileText, CheckSquare, Sparkles, ArrowLeft, 
  RefreshCw, Clock, PlusCircle, Calendar, AlignLeft, X, 
  Layers, Search, AlertCircle, Key,
  LayoutDashboard, Settings, User as UserIcon, LogIn, Building2
} from 'lucide-react';
import confetti from 'canvas-confetti';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function UserDashboard({ onNavigateHome, onOpenTryModal, defaultTab }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: routeMeetingId } = useParams();

  const [micActive, setMicActive] = useState(false);
  const [meetingsList, setMeetingsList] = useState([]);
  const [plannedMeetingsList, setPlannedMeetingsList] = useState([]);
  const [loadingPlannedMeetings, setLoadingPlannedMeetings] = useState(true);
  const [plannedMeetingsError, setPlannedMeetingsError] = useState('');
  const [briefingsList, setBriefingsList] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [meetingAccessDenied, setMeetingAccessDenied] = useState(false);
  const [linkedPlannedMeeting, setLinkedPlannedMeeting] = useState(null);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  // Meeting Creation State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSubmittingMeeting, setIsSubmittingMeeting] = useState(false);
  const [meetingFormData, setMeetingFormData] = useState({
    title: '',
    recipientEmail: '',
    agenda: '',
    scheduledAt: '',
  });

  // Archive Modal State
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [archiveSearch, setArchiveSearch] = useState('');
  const meetingRequestVersion = useRef(0);
  const meetingRefreshTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLinkedPlannedMeeting(null);
    if (!selectedMeeting?.id) return () => { cancelled = true; };
    supabase.from('planned_meetings').select('*').eq('linked_meeting_id', selectedMeeting.id).maybeSingle()
      .then(({ data, error: lookupError }) => {
        if (!cancelled && !lookupError) setLinkedPlannedMeeting(data || null);
      });
    return () => { cancelled = true; };
  }, [selectedMeeting?.id]);

  // Derive active tab from location pathname or defaultTab prop
  const currentPath = location.pathname;
  let activeTab = 'overview';
  if (currentPath.startsWith('/meetings') || defaultTab === 'meetings') {
    activeTab = 'meetings';
  } else if (currentPath.startsWith('/settings') || defaultTab === 'settings') {
    activeTab = 'settings';
  } else if (currentPath.startsWith('/profile') || defaultTab === 'profile') {
    activeTab = 'profile';
  }

  // Fetch AI Briefings from backend authorized for user
  const fetchBriefings = async () => {
    try {
      if (!user?.email && !user?.id) {
        setBriefingsList([]);
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/briefings`, {
        headers: {
          'x-user-email': user?.email || '',
          'x-user-id': user?.id || '',
          'x-user-role': user?.role || 'user',
        },
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.briefings || []);
        setBriefingsList(list);
      }
    } catch (err) {
      console.warn('Briefings query notice:', err);
    }
  };

  // Fetch real meetings from Supabase Postgres database
  const fetchMeetings = async ({ silent = false } = {}) => {
    const requestId = ++meetingRequestVersion.current;
    try {
      if (!silent) setLoadingMeetings(true);
      const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        if (requestId < meetingRequestVersion.current) return;
        setMeetingsList((current) => mergeMeetingRows(current, data));
        // If route has meeting id, find and select it
        if (routeMeetingId) {
          const match = data.find(
            (m) => String(m.id) === String(routeMeetingId) || m.bot_id === routeMeetingId
          );
          if (match) {
            setSelectedMeeting((current) => mergeMeetingRows(current ? [current] : [], [match])[0] || match);
            setMeetingAccessDenied(false);
          } else {
            setSelectedMeeting(null);
            setMeetingAccessDenied(true);
          }
        }
      } else {
        if (routeMeetingId) {
          setSelectedMeeting(null);
          setMeetingAccessDenied(true);
        }
      }
    } catch (err) {
      console.warn('Meetings query notice:', err);
    } finally {
      if (!silent) setLoadingMeetings(false);
    }
  };

  // RLS limits this read to planned meetings assigned to the signed-in user.
  // The legacy schedule flow above remains unchanged.
  const fetchPlannedMeetings = async () => {
    try {
      setLoadingPlannedMeetings(true);
      const { data, error } = await supabase
        .from('planned_meetings')
        .select('*')
        .eq('status', 'planned')
        .gte('scheduled_for', new Date().toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(8);
      if (error) throw error;
      setPlannedMeetingsList(data || []);
      setPlannedMeetingsError('');
    } catch (err) {
      console.warn('Planned meetings query notice:', err);
      setPlannedMeetingsList([]);
      setPlannedMeetingsError(err.message || 'Upcoming planned meetings are unavailable.');
    } finally {
      setLoadingPlannedMeetings(false);
    }
  };

  useEffect(() => {
    fetchMeetings();
    fetchBriefings();
    fetchPlannedMeetings();

    const scheduleRefresh = () => {
      if (meetingRefreshTimer.current) clearTimeout(meetingRefreshTimer.current);
      meetingRefreshTimer.current = setTimeout(() => { fetchMeetings({ silent: true }); }, 250);
    };
    const unsubscribe = subscribeToMeetingChanges('meetings_realtime_feed', {
      onChange: (payload) => {
        setMeetingsList((current) => applyMeetingChange(current, payload));
        if (payload?.new?.id) {
          setSelectedMeeting((current) => {
            if (!current || current.id !== payload.new.id) return current;
            return mergeMeetingRows([current], [payload.new])[0] || current;
          });
        }
        scheduleRefresh();
      },
      onStatus: (status, realtimeErr) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Realtime subscription notice:', realtimeErr?.message || status);
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
      if (meetingRefreshTimer.current) clearTimeout(meetingRefreshTimer.current);
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [routeMeetingId]);

  const handleTestMic = () => {
    setMicActive(!micActive);
    if (!micActive) {
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.7 } });
    }
  };

  const handleScheduleMeeting = async (e) => {
    e.preventDefault();
    if (!meetingFormData.title.trim()) return;

    try {
      setIsSubmittingMeeting(true);

      const res = await fetch(`${API_BASE_URL}/api/briefings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-email': user?.email || '',
          'x-user-id': user?.id || '',
          'x-user-role': user?.role || 'user',
        },
        body: JSON.stringify({
          title: meetingFormData.title,
          recipientEmail: meetingFormData.recipientEmail || user?.email,
          agenda: meetingFormData.agenda,
          scheduledAt: meetingFormData.scheduledAt,
          creatorEmail: user?.email,
          creatorUserId: user?.id,
        }),
      });

      if (!res.ok) throw new Error('Failed to schedule meeting briefing');

      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
      setMeetingFormData({ title: '', recipientEmail: '', agenda: '', scheduledAt: '' });
      setIsCreateModalOpen(false);

      await fetchBriefings();
      await fetchMeetings();
    } catch (err) {
      console.error('Error scheduling meeting:', err);
      alert('Could not schedule meeting: ' + err.message);
    } finally {
      setIsSubmittingMeeting(false);
    }
  };

  const filteredArchive = briefingsList.filter((b) =>
    (b.title || '').toLowerCase().includes(archiveSearch.toLowerCase()) ||
    (b.agenda || '').toLowerCase().includes(archiveSearch.toLowerCase())
  );

  const handleSignOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const handleBackHome = () => {
    if (onNavigateHome) onNavigateHome();
    navigate('/');
  };

  const handleOpenMeeting = (meeting) => {
    setSelectedMeeting(meeting);
    setMeetingAccessDenied(false);
    navigate(`/meetings/${meeting.id}`);
  };

  const handleCloseMeetingModal = () => {
    setSelectedMeeting(null);
    setMeetingAccessDenied(false);
    if (routeMeetingId) {
      navigate('/meetings');
    }
  };

  const handleLaunchAssistant = () => {
    if (onOpenTryModal) {
      onOpenTryModal();
    } else {
      navigate('/?try=true');
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      {/* Top Navigation Bar with Primary Action Buttons */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-black/5 px-6 py-3.5 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBackHome}
            className="p-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/70 hover:text-black transition-colors cursor-pointer"
            title="Return to Landing Page"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="font-fustat font-extrabold text-[20px] text-black flex items-center gap-2.5">
            <div className="p-1 rounded-lg bg-white border border-black/10 shadow-2xs flex items-center shrink-0" title="CHARUSAT">
              <img src="/college-logo.png" alt="CHARUSAT Logo" className="h-6 w-auto object-contain" />
            </div>
            <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0">
              <img src="/revora-icon.png" alt="Revora" className="h-7 w-7 object-contain shrink-0" />
            </div>
            <span>Revora Dashboard</span>
            {user?.clientName ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 uppercase flex items-center gap-1">
                <Building2 className="w-3 h-3" />
                Client: {user.clientName}
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-[#0084FF] uppercase">
                User Portal
              </span>
            )}
          </div>
        </div>

        {/* Primary Schedule Button & User Profile Badge */}
        <div className="flex items-center gap-3">
          {user?.role === 'admin' && (
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-[#0084FF] hover:bg-[#0070D8] text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-xs hover:scale-105 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Schedule Meeting</span>
            </button>
          )}

          {user ? (
            <button
              onClick={() => navigate('/profile')}
              className="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200/80 border border-black/5 transition-colors cursor-pointer text-left"
              title="View Profile"
            >
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt="User Avatar"
                  className="w-7 h-7 rounded-full object-cover border border-white"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#0084FF] text-white flex items-center justify-center text-xs font-bold uppercase shadow-2xs shrink-0">
                  {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="hidden sm:flex flex-col text-left leading-tight">
                <span className="font-bold text-xs text-black">{user?.name || 'Standard User'}</span>
                <span className="text-[10px] text-black/50">
                  {user?.clientName ? `Client: ${user.clientName}` : user?.email}
                </span>
              </div>
            </button>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="px-4 py-2 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Sub Navigation Bar Tabs */}
      <div className="border-b border-black/5 bg-white px-6">
        <div className="max-w-[1280px] mx-auto flex items-center gap-2 sm:gap-6 overflow-x-auto py-2 text-xs font-bold">
          <button
            onClick={() => navigate('/dashboard')}
            className={`px-3 py-2 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-[#0084FF]/10 text-[#0084FF]'
                : 'text-black/60 hover:text-black hover:bg-black/5'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Overview</span>
          </button>

          <button
            onClick={() => navigate('/meetings')}
            className={`px-3 py-2 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'meetings'
                ? 'bg-[#0084FF]/10 text-[#0084FF]'
                : 'text-black/60 hover:text-black hover:bg-black/5'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Meetings & Transcripts</span>
            {meetingsList.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[#0084FF] text-white">
                {meetingsList.length}
              </span>
            )}
          </button>

          <button
            onClick={() => navigate('/settings')}
            className={`px-3 py-2 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-[#0084FF]/10 text-[#0084FF]'
                : 'text-black/60 hover:text-black hover:bg-black/5'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>

          <button
            onClick={() => navigate('/profile')}
            className={`px-3 py-2 rounded-xl flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'profile'
                ? 'bg-[#0084FF]/10 text-[#0084FF]'
                : 'text-black/60 hover:text-black hover:bg-black/5'
            }`}
          >
            <UserIcon className="w-4 h-4" />
            <span>Profile</span>
          </button>
        </div>
      </div>

      {/* Main Content Layout */}
      <main className="max-w-[1280px] mx-auto px-6 py-8 space-y-8">
        
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <>
            {/* Welcome Hero Card */}
            <div className="p-8 rounded-[28px] bg-gradient-to-br from-[#0084FF] to-[#0066CC] text-white shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative overflow-hidden">
              <div className="relative z-10 max-w-[600px]">
                <span className="px-3 py-1 rounded-full bg-white/20 text-xs font-bold uppercase tracking-wider">
                  {user?.clientName ? `Client Organization: ${user.clientName} • Client Portal` : `Authenticated Session • Role: ${user?.role || 'user'}`}
                </span>
                <h1 className="font-outfit font-black text-[30px] sm:text-[36px] leading-tight mt-3">
                  Welcome back, {user?.name || 'User'}!
                </h1>
                <p className="font-sans text-sm text-white/80 mt-2 leading-relaxed">
                  {user?.clientName
                    ? `Accessing your dedicated client workspace for ${user.clientName}. View your project meetings, recordings, AI briefings, and transcripts with secure data isolation.`
                    : 'Your Revora AI assistant is active and ready to schedule meetings, transcribe live calls, and extract action items.'}
                </p>
              </div>

              {/* Hero Action Button: Launch Assistant */}
              <div className="relative z-10 flex items-center gap-3">
                <button
                  onClick={handleLaunchAssistant}
                  className="px-6 py-3.5 rounded-2xl bg-white text-[#0084FF] font-bold text-sm hover:bg-sky-50 transition-all hover:scale-105 shadow-lg cursor-pointer shrink-0 flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-[#0084FF]" />
                  <span>Launch Revora Assistant</span>
                </button>
              </div>

              <div className="absolute -right-12 -bottom-12 w-64 h-64 bg-white/10 rounded-full blur-2xl pointer-events-none" />
            </div>

            {/* Interactive Meeting Calendar */}
            <MeetingCalendar
              meetings={meetingsList}
              briefings={briefingsList}
              plannedMeetings={plannedMeetingsList}
              onSelectMeeting={(m) => setSelectedMeeting(m)}
            />

            {/* Read-only planned meetings feed. Visibility is enforced by the planned_meetings RLS policy. */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-outfit font-bold text-lg text-black">Upcoming Planned Meetings</h3>
                  <p className="text-xs text-black/50">Briefings prepared for meetings shared with you.</p>
                </div>
                {plannedMeetingsList.length > 0 && <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-[#0084FF]">
                  {plannedMeetingsList.length} upcoming
                </span>}
              </div>
              {plannedMeetingsError && <p className="text-xs text-black/50">Upcoming planned meetings are unavailable until the planned-meetings migration is installed.</p>}
              {!plannedMeetingsError && loadingPlannedMeetings && <p role="status" className="text-xs text-black/50">Loading upcoming planned meetings…</p>}
              {!plannedMeetingsError && !loadingPlannedMeetings && plannedMeetingsList.length === 0 && <div className="p-5 rounded-2xl bg-white border border-black/10 text-center text-xs text-black/50">
                No upcoming planned meetings have been shared with you.
              </div>}
              {!plannedMeetingsError && plannedMeetingsList.map((plannedMeeting) => <div key={plannedMeeting.id} className="p-4 rounded-2xl bg-white border border-black/10 shadow-xs space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-sm text-black">{plannedMeeting.title || 'Planned meeting'}</h4>
                    <p className="text-xs text-black/50 font-mono">{new Date(plannedMeeting.scheduled_for).toLocaleString()}</p>
                  </div>
                   <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-sky-50 text-[#0084FF] border border-sky-100">Planned</span>
                </div>
                {plannedMeeting.agenda && <p className="text-xs text-black/70 leading-relaxed">{plannedMeeting.agenda}</p>}
                <ContextBriefingSection key={`${plannedMeeting.id}:${plannedMeeting.updated_at || ''}`} plannedMeeting={plannedMeeting} />
              </div>)}
            </section>

            {/* Live Pre-Meeting Briefing Feed with Archive Button */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <h3 className="font-outfit font-bold text-lg text-black">Latest Pre-Meeting Briefing</h3>
                  {briefingsList.length > 0 && (
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-sky-100 text-[#0084FF]">
                      Active
                    </span>
                  )}
                </div>

                {briefingsList.length > 1 && (
                  <button
                    onClick={() => setIsArchiveModalOpen(true)}
                    className="px-3.5 py-1.5 rounded-xl bg-white border border-black/10 hover:border-[#0084FF]/40 text-xs font-bold text-black/80 hover:text-[#0084FF] flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                  >
                    <Layers className="w-3.5 h-3.5 text-[#0084FF]" />
                    <span>View All Briefings ({briefingsList.length})</span>
                  </button>
                )}
              </div>

              {briefingsList.length > 0 ? (
                <BriefingCard briefing={briefingsList[0]} />
              ) : (
                <div className="p-6 rounded-2xl bg-white border border-black/10 text-center space-y-2">
                  <Sparkles className="w-6 h-6 text-[#0084FF] mx-auto animate-pulse" />
                  <h4 className="font-bold text-sm text-black">No meetings yet</h4>
                  <p className="text-xs text-black/50 max-w-[420px] mx-auto">
                    Pre-meeting briefings for meetings you are scheduled to attend will appear here.
                  </p>
                </div>
              )}
            </section>

            {/* Quick Tools Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                  onClick={handleLaunchAssistant}
                  className="mt-6 py-2.5 px-4 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Generate Summary</span>
                </button>
              </div>

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
          </>
        )}

        {/* TAB 2: MEETINGS & TRANSCRIPTS (Also shown at bottom of Overview) */}
        {(activeTab === 'overview' || activeTab === 'meetings') && (
          <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-4 border-b border-black/5">
              <div>
                <h3 className="font-outfit font-bold text-lg text-black">Live Meeting Summaries & Transcripts</h3>
                <p className="text-xs text-black/50">Real-time feed connected to Revora AI & MeetingBaaS</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => { fetchMeetings(); fetchBriefings(); }}
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
                          onClick={() => handleOpenMeeting(m)}
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
                <div className="p-6 rounded-2xl bg-neutral-50 text-center space-y-2">
                  <Clock className="w-8 h-8 text-[#0084FF] mx-auto animate-pulse" />
                  <h4 className="font-outfit font-bold text-base text-black">No meetings yet</h4>
                  <p className="text-xs text-black/60 max-w-[480px] mx-auto leading-relaxed">
                    Meetings and transcripts you attend will automatically appear here once processed.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="p-6 rounded-[28px] bg-white border border-black/10 shadow-xs space-y-6">
              <div className="border-b border-black/5 pb-4">
                <h3 className="font-outfit font-bold text-xl text-black">Application & AI Settings</h3>
                <p className="text-xs text-black/50">Manage model configurations, webhooks, and preferences</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 rounded-2xl bg-neutral-50 border border-black/5 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-5 h-5 text-[#0084FF]" />
                    <h4 className="font-bold text-sm text-black">AI Intelligence Model</h4>
                  </div>
                  <p className="text-xs text-black/60">Configured model for real-time synthesis & summaries.</p>
                  <div className="px-3.5 py-2 rounded-xl bg-white border border-black/10 font-mono text-xs text-black font-semibold flex items-center justify-between">
                    <span>Google Gemini 1.5 Flash</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">Active</span>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-neutral-50 border border-black/5 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <Key className="w-5 h-5 text-amber-600" />
                    <h4 className="font-bold text-sm text-black">Speech-To-Text Engine</h4>
                  </div>
                  <p className="text-xs text-black/60">Audio transcription provider for MeetingBaaS integration.</p>
                  <div className="px-3.5 py-2 rounded-xl bg-white border border-black/10 font-mono text-xs text-black font-semibold flex items-center justify-between">
                    <span>ElevenLabs Scribe · Batch</span>
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">Default</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PROFILE */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div className="p-8 rounded-[28px] bg-white border border-black/10 shadow-xs space-y-6 max-w-[800px]">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 border-b border-black/5 pb-6">
                <div className="flex items-center gap-5">
                  {user?.avatar ? (
                    <img
                      src={user.avatar}
                      alt="Profile Avatar"
                      className="w-20 h-20 rounded-2xl object-cover border-2 border-[#0084FF]/20 shadow-md"
                    />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#0084FF] to-[#0066CC] text-white flex items-center justify-center text-3xl font-black shadow-md">
                      {(user?.name || user?.email || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="space-y-1">
                    <h3 className="font-outfit font-black text-2xl text-black">{user?.name || 'Standard User'}</h3>
                    <p className="text-xs text-black/50 font-mono">{user?.email || 'guest@revora.ai'}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono ${
                        user?.role === 'admin' 
                          ? 'bg-amber-100 text-amber-800' 
                          : user?.clientName || user?.role === 'client'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-sky-100 text-[#0084FF]'
                      }`}>
                        Role: {user?.clientName ? 'Client Account' : (user?.role || 'user')}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 font-mono">
                        Status: Active
                      </span>
                    </div>
                  </div>
                </div>

                {/* Log Out button in Profile */}
                {user ? (
                  <button
                    onClick={handleSignOut}
                    className="px-4 py-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-200/60 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs hover:shadow-xs self-start sm:self-center shrink-0"
                    title="Log out and return to main dashboard"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log Out Account</span>
                  </button>
                ) : (
                  <button
                    onClick={() => navigate('/login')}
                    className="px-4 py-2.5 rounded-xl bg-[#0084FF] hover:bg-[#0074E0] text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs self-start sm:self-center shrink-0"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                  </button>
                )}
              </div>

              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-neutral-50 border border-black/5">
                    <span className="text-black/50 font-medium block mb-1">User Identifier</span>
                    <span className="font-mono font-bold text-black">{user?.id || '—'}</span>
                  </div>
                  <div className="p-4 rounded-xl bg-neutral-50 border border-black/5">
                    <span className="text-black/50 font-medium block mb-1">
                      {user?.clientName ? 'Client Organization' : 'Account Created'}
                    </span>
                    <span className="font-mono font-bold text-black">
                      {user?.clientName ? `${user.clientName}${user.clientCompany ? ` (${user.clientCompany})` : ''}` : (user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Active Session')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal 1: Schedule Meeting & Auto-Dispatch Briefing (Admin Only) */}
        {user?.role === 'admin' && isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-[28px] max-w-[560px] w-full p-6 space-y-5 border border-black/10 shadow-2xl relative max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-black/5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-sky-100 text-[#0084FF] flex items-center justify-center">
                    <PlusCircle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-outfit font-bold text-lg text-black">Schedule New Meeting</h3>
                    <p className="text-xs text-black/50">Auto-generate and email an AI briefing to attendees</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsCreateModalOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-black/5 text-black/60 hover:text-black transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleScheduleMeeting} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-black mb-1">
                    Meeting Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Q4 Sprint Planning & Architecture Sync"
                    value={meetingFormData.title}
                    onChange={(e) => setMeetingFormData({ ...meetingFormData, title: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-black/10 bg-neutral-50 focus:bg-white focus:border-[#0084FF] focus:outline-none text-xs text-black"
                  />
                </div>

                {/* Attendee Directory Multi-Select Picker */}
                <AttendeePicker
                  selectedEmails={meetingFormData.recipientEmail}
                  onChange={(emails) => setMeetingFormData({ ...meetingFormData, recipientEmail: emails })}
                />

                <div>
                  <label className="block text-xs font-bold text-black mb-1 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#0084FF]" />
                    <span>Scheduled Date & Time</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={meetingFormData.scheduledAt}
                    onChange={(e) => setMeetingFormData({ ...meetingFormData, scheduledAt: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-black/10 bg-neutral-50 focus:bg-white focus:border-[#0084FF] focus:outline-none text-xs text-black"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-black mb-1 flex items-center gap-1.5">
                    <AlignLeft className="w-3.5 h-3.5 text-[#0084FF]" />
                    <span>Meeting Context & Agenda</span>
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Briefly outline topics to cover, goals, or prerequisites for the Gemini AI brief..."
                    value={meetingFormData.agenda}
                    onChange={(e) => setMeetingFormData({ ...meetingFormData, agenda: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-black/10 bg-neutral-50 focus:bg-white focus:border-[#0084FF] focus:outline-none text-xs text-black resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-black/5">
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-black/5 hover:bg-black/10 text-xs font-bold text-black/70 cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingMeeting}
                    className="px-5 py-2.5 rounded-xl bg-[#0084FF] hover:bg-[#0070D8] text-white font-bold text-xs shadow-md transition-all hover:scale-102 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingMeeting ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Dispatching AI Brief...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Schedule & Auto-Dispatch</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal 2: All Briefings Archive Modal */}
        {isArchiveModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-[28px] max-w-[800px] w-full max-h-[85vh] p-6 flex flex-col border border-black/10 shadow-2xl relative">
              <div className="flex items-center justify-between pb-4 border-b border-black/5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-sky-100 text-[#0084FF] flex items-center justify-center">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-outfit font-bold text-lg text-black">Briefings Archive</h3>
                    <p className="text-xs text-black/50">{briefingsList.length} total generated intelligence briefs</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsArchiveModalOpen(false)}
                  className="p-1.5 rounded-xl hover:bg-black/5 text-black/60 hover:text-black transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search bar inside archive */}
              <div className="py-3">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3.5 top-3 text-black/40" />
                  <input
                    type="text"
                    placeholder="Search past briefings by title or context..."
                    value={archiveSearch}
                    onChange={(e) => setArchiveSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-neutral-50 border border-black/10 text-xs text-black focus:outline-none focus:border-[#0084FF] focus:bg-white"
                  />
                </div>
              </div>

              {/* Scrollable list of cards */}
              <div className="overflow-y-auto space-y-4 pr-1 flex-1 max-h-[500px]">
                {filteredArchive.length > 0 ? (
                  filteredArchive.map((b, idx) => (
                    <BriefingCard key={b.id || idx} briefing={b} />
                  ))
                ) : (
                  <p className="text-xs text-black/40 text-center py-8">No briefings match your search query.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal 3: Selected Meeting Details Modal */}
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
                  onClick={handleCloseMeetingModal}
                  className="px-3 py-1.5 rounded-xl bg-black/5 hover:bg-black/10 text-xs font-bold text-black/70 cursor-pointer"
                >
                  Close
                </button>
              </div>

               <ContextBriefingSection key={`${selectedMeeting.id}:${selectedMeeting.project_id || ''}`} meeting={selectedMeeting} />
               {linkedPlannedMeeting && <section className="space-y-2">
                 <h4 className="text-xs font-bold text-black uppercase tracking-wider">Pre-meeting briefing</h4>
                 <ContextBriefingSection key={`planned:${linkedPlannedMeeting.id}`} plannedMeeting={linkedPlannedMeeting} readOnly />
               </section>}

               {(selectedMeeting.bot_id || selectedMeeting.recording_url) && <MeetingRecordingLink key={selectedMeeting.id} meeting={selectedMeeting} />}

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
                      {transcriptParagraphs(selectedMeeting).length} dialogue turns • {selectedMeeting.transcript.length} characters
                    </span>
                  </div>
                  <div className="p-4 rounded-2xl bg-neutral-50 border border-black/5 text-xs text-black/80 font-mono whitespace-pre-wrap leading-relaxed max-h-[350px] overflow-y-auto shadow-inner">
                    {transcriptDisplayText(selectedMeeting)}
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

        {/* Modal: Access Denied / Inaccessible Meeting for Direct Route */}
        {meetingAccessDenied && routeMeetingId && !loadingMeetings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
            <div className="bg-white rounded-[28px] max-w-[460px] w-full p-6 text-center space-y-4 border border-black/10 shadow-2xl">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-outfit font-bold text-lg text-black">Meeting Inaccessible</h3>
                <p className="text-xs text-black/60 max-w-[360px] mx-auto leading-relaxed">
                  This meeting either does not exist or you do not have authorization to access its records, transcripts, or briefings.
                </p>
              </div>
              <div className="pt-2">
                <button
                  onClick={handleCloseMeetingModal}
                  className="px-5 py-2.5 rounded-xl bg-[#0084FF] hover:bg-[#0070D8] text-white font-bold text-xs transition-colors cursor-pointer shadow-xs"
                >
                  Return to My Meetings
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Task Extractor Modal */}
      <TaskExtractorModal
        isOpen={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
      />
    </div>
  );
}
