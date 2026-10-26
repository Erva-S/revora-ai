import React, { useState } from 'react';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  Clock, Users, Video, Building2, FolderGit2, ExternalLink
} from 'lucide-react';
import MeetingDetailsModal from './MeetingDetailsModal';
import { meetingStageLabel, meetingStageClasses } from '../lib/meetingStatus';

export default function MeetingCalendar({ 
  meetings = [], 
  briefings = [], 
  plannedMeetings = [], 
  onSelectMeeting,
  currentUser 
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [selectedEvent, setSelectedEvent] = useState(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Helper: Extract scheduled or held date
  const getEventHeldDate = (item) => {
    if (!item) return null;

    // 1. Direct scheduled/held timestamp fields
    const raw = 
      item.scheduled_for ||
      item.scheduledFor ||
      item.scheduledAt || 
      item.scheduled_at || 
      item.scheduledTime || 
      item.scheduled_time || 
      item.started_at ||
      item.startedAt ||
      item.startTime ||
      item.meeting_time ||
      item.meetingDate ||
      item.meeting_date || 
      item.event_date ||
      (item.status === 'completed' || item.status === 'summarized' || item.bot_id ? (item.created_at || item.createdAt) : null);

    if (raw) {
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // 2. Look inside metadata or briefing payload object if nested
    if (item.metadata) {
      const metaDate = 
        item.metadata.scheduled_for || 
        item.metadata.scheduledFor || 
        item.metadata.scheduledAt || 
        item.metadata.scheduled_at;
      if (metaDate) {
        const parsed = new Date(metaDate);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    }

    // 3. Look for datetime strings in text fields (e.g., "2026-09-07T11:00")
    const searchString = `${item.title || ''} ${item.agenda || ''} ${item.details || ''} ${item.context || ''}`;
    const isoMatch = searchString.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/);
    if (isoMatch) {
      const parsedIso = new Date(isoMatch[0].replace(' ', 'T'));
      if (!isNaN(parsedIso.getTime())) return parsedIso;
    }

    return null;
  };

  // Raw mapping from the three sources
  const rawEvents = [
    ...meetings.map((m) => {
      const date = getEventHeldDate(m);
      if (!date) return null;
      return {
        id: m.id || m.bot_id || String(Math.random()),
        meetingId: m.id,
        botId: m.bot_id,
        title: m.title || 'Live Video Session',
        date,
        type: 'meeting',
        status: m.status,
        processing_stage: m.processing_stage,
        meetingUrl: m.meeting_url || m.meetingUrl,
        agenda: m.agenda || m.summaryContext,
        summary: m.summary,
        transcript: m.transcript,
        actionItems: m.action_items || m.actionItems,
        recordingUrl: m.recording_url,
        attendees: m.attendees || m.recipient_email || m.recipientEmail,
        clientName: m.clientName || m.client_name || m.clients?.name || m.projects?.clients?.name || null,
        projectName: m.projectName || m.project_name || m.projects?.name || null,
        raw: m
      };
    }),
    ...briefings.map((b) => {
      const date = getEventHeldDate(b);
      if (!date) return null;
      return {
        id: b.id || String(Math.random()),
        briefingId: b.id,
        title: b.title || 'Scheduled Sync Briefing',
        date,
        type: 'briefing',
        status: b.status || 'briefing_ready',
        meetingUrl: b.meetingUrl || b.meeting_url,
        agenda: b.agenda,
        summary: b.summary || b.summaryContext,
        transcript: b.transcript,
        actionItems: b.actionItems || b.action_items,
        attendees: b.recipientEmail || b.recipient_email,
        clientName: b.clientName || b.client_name || null,
        projectName: b.projectName || b.project_name || null,
        raw: b
      };
    }),
    ...plannedMeetings.map((p) => {
      const date = getEventHeldDate(p);
      if (!date) return null;
      return {
        id: p.id || String(Math.random()),
        plannedId: p.id,
        linkedMeetingId: p.linked_meeting_id,
        title: p.title || 'Planned Meeting Briefing',
        date,
        type: 'planned',
        status: p.status || 'scheduled',
        meetingUrl: p.meeting_url || p.meetingUrl,
        agenda: p.agenda,
        attendees: p.recipientEmail || p.recipient_email || 'Attendees',
        clientName: p.clientName || p.client_name || p.clients?.name || p.projects?.clients?.name || null,
        projectName: p.projectName || p.project_name || p.projects?.name || null,
        raw: p
      };
    })
  ].filter(Boolean);

  // Deduplication logic: merge multiple representations of the same meeting
  const deduplicatedEvents = (() => {
    const list = [];

    for (const evt of rawEvents) {
      const existingIdx = list.findIndex((item) => {
        // Match by meeting ID or linked meeting ID
        const itemId = item.meetingId || item.id;
        const evtId = evt.meetingId || evt.id;
        if (evt.linkedMeetingId && (evt.linkedMeetingId === itemId || evt.linkedMeetingId === item.raw?.id)) return true;
        if (item.linkedMeetingId && (item.linkedMeetingId === evtId || item.linkedMeetingId === evt.raw?.id)) return true;
        if (item.meetingId && evt.meetingId && String(item.meetingId) === String(evt.meetingId)) return true;

        // Proximity on the same calendar day
        const sameDay = 
          item.date.getFullYear() === evt.date.getFullYear() &&
          item.date.getMonth() === evt.date.getMonth() &&
          item.date.getDate() === evt.date.getDate();

        if (!sameDay) return false;

        const timeDiffMs = Math.abs(item.date.getTime() - evt.date.getTime());

        // Match by meeting URL within 2 hours
        const u1 = (item.meetingUrl || '').trim().toLowerCase().replace(/\/$/, '');
        const u2 = (evt.meetingUrl || '').trim().toLowerCase().replace(/\/$/, '');
        if (u1 && u2 && u1 === u2 && timeDiffMs <= 2 * 3600 * 1000) return true;

        // Match by title within 1 hour
        const t1 = (item.title || '').trim().toLowerCase();
        const t2 = (evt.title || '').trim().toLowerCase();
        if (t1 && t2 && t1 === t2 && timeDiffMs <= 3600 * 1000) return true;

        return false;
      });

      if (existingIdx >= 0) {
        const curr = list[existingIdx];
        const isEvtMoreAdvanced = 
          ['summarized', 'completed', 'recording', 'bot_dispatched'].includes(evt.status) || 
          Boolean(evt.summary || evt.transcript || evt.botId);

        list[existingIdx] = {
          ...curr,
          ...(isEvtMoreAdvanced ? evt : {}),
          meetingUrl: curr.meetingUrl || evt.meetingUrl,
          agenda: curr.agenda || evt.agenda,
          attendees: curr.attendees || evt.attendees,
          clientName: curr.clientName || evt.clientName,
          projectName: curr.projectName || evt.projectName,
          summary: curr.summary || evt.summary,
          transcript: curr.transcript || evt.transcript,
          actionItems: curr.actionItems || evt.actionItems,
          botId: curr.botId || evt.botId,
          recordingUrl: curr.recordingUrl || evt.recordingUrl,
          meetingId: curr.meetingId || evt.meetingId,
          raw: {
            ...evt.raw,
            ...curr.raw,
            meeting_url: curr.meetingUrl || evt.meetingUrl || curr.raw?.meeting_url || evt.raw?.meeting_url,
            summary: curr.summary || evt.summary || curr.raw?.summary || evt.raw?.summary,
            transcript: curr.transcript || evt.transcript || curr.raw?.transcript || evt.raw?.transcript,
            action_items: curr.actionItems || evt.actionItems || curr.raw?.action_items || evt.raw?.action_items,
          }
        };
      } else {
        list.push(evt);
      }
    }

    return list;
  })();

  // Filter events for the selected day in current month & year
  const selectedDayEvents = deduplicatedEvents.filter((event) => {
    return (
      event.date.getFullYear() === year &&
      event.date.getMonth() === month &&
      event.date.getDate() === selectedDay
    );
  });

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(1);
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(1);
  };

  const handleEventClick = (evt) => {
    if (onSelectMeeting) {
      onSelectMeeting(evt.raw || evt);
    } else {
      setSelectedEvent(evt.raw || evt);
    }
  };

  return (
    <div className="p-6 rounded-[28px] bg-white border border-black/10 shadow-xs space-y-6">
      {/* Calendar Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-sky-50 text-[#0084FF] flex items-center justify-center border border-sky-100">
            <CalendarIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-outfit font-bold text-lg text-black">Meeting Calendar</h3>
            <p className="text-xs text-black/50">Events plotted strictly by scheduled meeting date with live sync</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <span className="font-outfit font-bold text-sm text-black mr-2">
            {monthNames[month]} {year}
          </span>
          <button
            type="button"
            onClick={prevMonth}
            className="p-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/70 hover:text-black transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="p-2 rounded-xl bg-black/5 hover:bg-black/10 text-black/70 hover:text-black transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 7-Day Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Calendar Left */}
        <div className="lg:col-span-7 space-y-2">
          <div className="grid grid-cols-7 text-center font-mono text-[11px] font-bold text-black/40 uppercase py-1">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDayIndex }).map((_, i) => (
              <div key={`empty-${i}`} className="h-11 rounded-xl bg-transparent" />
            ))}

            {Array.from({ length: totalDaysInMonth }).map((_, i) => {
              const dayNum = i + 1;
              const dayHasEvents = deduplicatedEvents.some(
                (e) =>
                  e.date.getFullYear() === year &&
                  e.date.getMonth() === month &&
                  e.date.getDate() === dayNum
              );
              const isSelected = selectedDay === dayNum;

              return (
                <button
                  key={`day-${dayNum}`}
                  type="button"
                  onClick={() => setSelectedDay(dayNum)}
                  className={`h-11 rounded-xl flex flex-col items-center justify-center relative font-sans text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#0084FF] text-white shadow-md scale-105'
                      : 'hover:bg-neutral-100 text-black/80'
                  }`}
                >
                  <span>{dayNum}</span>
                  {dayHasEvents && (
                    <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${
                      isSelected ? 'bg-white' : 'bg-[#0084FF]'
                    }`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Day Agenda Right */}
        <div className="lg:col-span-5 p-4 rounded-2xl bg-neutral-50 border border-black/5 flex flex-col justify-between space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-black/5">
              <span className="font-outfit font-bold text-xs text-black">
                {monthNames[month]} {selectedDay}, {year}
              </span>
              <span className="text-[10px] font-mono font-bold text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full">
                {selectedDayEvents.length} {selectedDayEvents.length === 1 ? 'Meeting' : 'Meetings'}
              </span>
            </div>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {selectedDayEvents.length > 0 ? (
                selectedDayEvents.map((evt, idx) => {
                  const isDone = evt.status === 'summarized' || evt.status === 'completed';
                  return (
                    <div
                      key={evt.id || idx}
                      onClick={() => handleEventClick(evt)}
                      className="p-3.5 rounded-xl bg-white border border-black/5 hover:border-[#0084FF]/40 hover:shadow-xs transition-all cursor-pointer space-y-2 shadow-2xs group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-bold text-xs text-black truncate max-w-[190px] group-hover:text-[#0084FF] transition-colors">
                          {evt.title}
                        </h4>
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono border ${meetingStageClasses(evt.raw || evt)}`}>
                          {meetingStageLabel(evt.raw || evt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-[10px] text-black/50 font-mono">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-black/40" />
                          {evt.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {evt.attendees && (
                          <span className="flex items-center gap-1 truncate max-w-[120px]">
                            <Users className="w-3 h-3 text-black/40 shrink-0" />
                            <span className="truncate">{evt.attendees}</span>
                          </span>
                        )}
                      </div>

                      {(evt.clientName || evt.projectName || evt.meetingUrl) && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          {evt.clientName && (
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-semibold flex items-center gap-1">
                              <Building2 className="w-2.5 h-2.5 text-[#0084FF]" />
                              <span className="truncate max-w-[100px]">{evt.clientName}</span>
                            </span>
                          )}
                          {evt.projectName && (
                            <span className="px-2 py-0.5 rounded-md bg-sky-50 text-[#0084FF] text-[10px] font-semibold flex items-center gap-1">
                              <FolderGit2 className="w-2.5 h-2.5 text-[#0084FF]" />
                              <span className="truncate max-w-[100px]">{evt.projectName}</span>
                            </span>
                          )}
                          {evt.meetingUrl && (
                            <span className="px-2 py-0.5 rounded-md bg-neutral-100 text-slate-600 text-[10px] font-mono flex items-center gap-1">
                              <ExternalLink className="w-2.5 h-2.5 text-[#0084FF]" />
                              <span>{isDone ? 'Link Saved' : 'Join Link'}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center space-y-1.5 text-black/40">
                  <Video className="w-6 h-6 mx-auto stroke-1" />
                  <p className="text-xs">No meetings scheduled for this date</p>
                </div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-black/50 text-center font-mono">
            Click any scheduled item to view complete details, links &amp; results
          </div>
        </div>

      </div>

      {/* Complete Meeting Details & Post-Meeting Results Modal (uncontrolled) */}
      {!onSelectMeeting && selectedEvent && (
        <MeetingDetailsModal
          meeting={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}