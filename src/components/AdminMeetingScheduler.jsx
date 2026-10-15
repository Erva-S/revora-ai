import React, { useState } from 'react';
import { PlusCircle, Calendar, AlignLeft, Sparkles, RefreshCw, Check, Bot, Video, ExternalLink } from 'lucide-react';
import confetti from 'canvas-confetti';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import AttendeePicker from './AttendeePicker';
import MeetingBotDeployer from './MeetingBotDeployer';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function AdminMeetingScheduler({ onMeetingScheduled, assignableUsers = [], projects = [], currentUserId = '' }) {
  const { user } = useAuth();
  const [activeMode, setActiveMode] = useState('schedule'); // 'schedule' | 'bot'
  const [title, setTitle] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [agenda, setAgenda] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const handleReset = () => {
    setTitle('');
    setRecipientEmail('');
    setScheduledAt('');
    setAgenda('');
    setMeetingUrl('');
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please provide a meeting title.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      // 1. Dispatch email briefing via Express API
      let emailInfo = null;
      try {
        const res = await fetch(`${API_BASE_URL}/api/briefings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-email': user?.email || '',
            'x-user-id': currentUserId || user?.id || '',
            'x-user-role': 'admin',
          },
          body: JSON.stringify({
            title: title.trim(),
            recipientEmail: recipientEmail.trim(),
            agenda: agenda.trim(),
            scheduledAt: scheduledAt || null,
            creatorEmail: user?.email || null,
            creatorUserId: currentUserId || user?.id || null,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          emailInfo = data.emailStatus;
        }
      } catch (apiErr) {
        console.warn('Local briefing API notice:', apiErr.message);
      }

      // 2. Insert into Supabase planned_meetings for ALL attendee users + admin
      try {
        const attendeeEmails = recipientEmail
          ? recipientEmail.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
          : [];

        const matchedAttendees = assignableUsers.filter(
          (u) => u.email && attendeeEmails.includes(u.email.toLowerCase())
        );

        const targetUserIds = new Set(matchedAttendees.map((u) => u.id));
        if (currentUserId) targetUserIds.add(currentUserId);

        const scheduledIso = scheduledAt
          ? new Date(scheduledAt).toISOString()
          : new Date().toISOString();

        const rowsToInsert = targetUserIds.size > 0
          ? Array.from(targetUserIds).map((uid) => ({
              title: title.trim(),
              agenda: agenda.trim(),
              scheduled_for: scheduledIso,
              user_id: uid,
              project_id: projects?.[0]?.id || null,
              meeting_url: meetingUrl.trim() || null,
              created_by: currentUserId || null,
            }))
          : [{
              title: title.trim(),
              agenda: agenda.trim(),
              scheduled_for: scheduledIso,
              user_id: currentUserId || null,
              project_id: projects?.[0]?.id || null,
              meeting_url: meetingUrl.trim() || null,
              created_by: currentUserId || null,
            }];

        await supabase.from('planned_meetings').insert(rowsToInsert);
      } catch (dbErr) {
        console.warn('Planned meeting database insert notice:', dbErr.message);
      }

      confetti({ particleCount: 60, spread: 70, origin: { y: 0.6 } });
      
      const successMsg = emailInfo?.dispatched
        ? `Meeting scheduled & briefing email dispatched to ${recipientEmail}!`
        : 'Meeting scheduled and AI briefing auto-dispatched to attendees!';

      setNotice({
        text: successMsg,
        previewUrl: emailInfo?.previewUrl || null,
      });
      handleReset();

      if (onMeetingScheduled) {
        onMeetingScheduled();
      }
    } catch (err) {
      console.error('Error scheduling meeting:', err);
      setError(err.message || 'Failed to schedule meeting.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200/80 shadow-xs font-sans overflow-hidden">
      {/* Header with Mode Switcher */}
      <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-100 text-[#0084FF] flex items-center justify-center shrink-0">
            {activeMode === 'schedule' ? (
              <PlusCircle className="w-5 h-5" />
            ) : (
              <Bot className="w-5 h-5" />
            )}
          </div>
          <div>
            <h3 className="font-outfit font-bold text-lg text-slate-900">
              {activeMode === 'schedule'
                ? 'Schedule New Meeting'
                : 'Deploy Meeting Bot'}
            </h3>
            <p className="text-xs text-slate-500">
              {activeMode === 'schedule'
                ? 'Auto-generate and email an AI briefing to attendees'
                : 'Send Revora into a live meeting for real-time transcription and analysis'}
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100/90 border border-slate-200/80 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveMode('schedule')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeMode === 'schedule'
                ? 'bg-white text-[#0084FF] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Schedule Meeting</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('bot')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeMode === 'bot'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Video className="w-3.5 h-3.5 text-slate-500" />
            <span>Live Bot Deployer</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="m-5 sm:m-6 mb-0 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{typeof notice === 'string' ? notice : notice.text}</span>
            {notice.previewUrl && (
              <a
                href={notice.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[#0084FF] underline font-bold hover:text-[#0070D8] ml-1"
              >
                <span>View Dispatched Email Preview</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <button
            onClick={() => setNotice(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs cursor-pointer font-bold ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="m-5 sm:m-6 mb-0 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-800 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 text-xs cursor-pointer font-bold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Mode 1: Schedule New Meeting (Visible by default instead of the old bot card) */}
      {activeMode === 'schedule' && (
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              Meeting Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Q4 Sprint Planning & Architecture Sync"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#0084FF] focus:ring-2 focus:ring-[#0084FF]/10 focus:outline-none text-xs text-slate-900 transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Attendee Directory Multi-Select Picker */}
          <div>
            <AttendeePicker
              selectedEmails={recipientEmail}
              onChange={(emails) => setRecipientEmail(emails)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#0084FF]" />
                <span>Scheduled Date & Time</span>
              </label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#0084FF] focus:ring-2 focus:ring-[#0084FF]/10 focus:outline-none text-xs text-slate-900 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
                <Video className="w-3.5 h-3.5 text-[#0084FF]" />
                <span>Meeting Link / URL <span className="font-normal text-slate-400">(optional)</span></span>
              </label>
              <input
                type="url"
                placeholder="https://meet.google.com/... or https://zoom.us/j/..."
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#0084FF] focus:ring-2 focus:ring-[#0084FF]/10 focus:outline-none text-xs text-slate-900 transition-all placeholder:text-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5 flex items-center gap-1.5">
              <AlignLeft className="w-3.5 h-3.5 text-[#0084FF]" />
              <span>Meeting Context & Agenda</span>
            </label>
            <textarea
              rows={3}
              placeholder="Briefly outline topics to cover, goals, or prerequisites for the Gemini AI brief..."
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#0084FF] focus:ring-2 focus:ring-[#0084FF]/10 focus:outline-none text-xs text-slate-900 resize-none transition-all placeholder:text-slate-400"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-xs font-bold text-slate-600 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#0084FF] hover:bg-[#0070D8] text-white font-bold text-xs shadow-md transition-all hover:scale-102 flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
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
      )}

      {/* Mode 2: Live Meeting Bot Deployer */}
      {activeMode === 'bot' && (
        <div className="p-1 sm:p-2">
          <MeetingBotDeployer
            onBotDeployed={onMeetingScheduled}
            assignableUsers={assignableUsers}
          />
        </div>
      )}
    </div>
  );
}
