import React, { useState } from 'react';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  Clock, Users, Video 
} from 'lucide-react';

export default function MeetingCalendar({ meetings = [], briefings = [], onSelectMeeting }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Helper: Extract ONLY the scheduled/held date
  const getEventHeldDate = (item) => {
    // 1. Direct fields
    const raw = 
      item.scheduledAt || 
      item.scheduled_at || 
      item.scheduledTime || 
      item.scheduled_time || 
      item.meeting_time ||
      item.meetingDate ||
      item.meeting_date || 
      item.event_date;

    if (raw) {
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) return parsed;
    }

    // 2. Look inside metadata or briefing payload object if nested
    if (item.metadata) {
      const metaDate = item.metadata.scheduledAt || item.metadata.scheduled_at;
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

    // DO NOT fallback to created_at or today! Return null so it doesn't land on today.
    return null;
  };

  // Combine events only if they have a valid scheduled date
  const allEvents = [
    ...meetings.map((m) => {
      const date = getEventHeldDate(m);
      if (!date) return null;
      return {
        id: m.id || m.bot_id || Math.random(),
        title: m.title || 'Live Video Session',
        date,
        type: 'meeting',
        status: m.status,
        attendees: m.attendees || m.meeting_url || m.recipient_email || m.recipientEmail,
        raw: m
      };
    }),
    ...briefings.map((b) => {
      const date = getEventHeldDate(b);
      if (!date) return null;
      return {
        id: b.id || Math.random(),
        title: b.title || 'Scheduled Sync Briefing',
        date,
        type: 'briefing',
        status: b.status || 'briefing_ready',
        attendees: b.recipientEmail || b.recipient_email,
        raw: b
      };
    })
  ].filter(Boolean);

  // Filter events for the selected day in current month & year
  const selectedDayEvents = allEvents.filter((event) => {
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
            <p className="text-xs text-black/50">Events plotted strictly by scheduled meeting date</p>
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
              const dayHasEvents = allEvents.some(
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

            <div className="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
              {selectedDayEvents.length > 0 ? (
                selectedDayEvents.map((evt, idx) => (
                  <div
                    key={evt.id || idx}
                    onClick={() => onSelectMeeting && onSelectMeeting(evt.raw)}
                    className="p-3 rounded-xl bg-white border border-black/5 hover:border-[#0084FF]/30 transition-all cursor-pointer space-y-1.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-bold text-xs text-black truncate max-w-[180px]">
                        {evt.title}
                      </h4>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase font-mono ${
                        evt.status === 'summarized' || evt.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-sky-50 text-[#0084FF]'
                      }`}>
                        {evt.status || 'Scheduled'}
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
                  </div>
                ))
              ) : (
                <div className="py-10 text-center space-y-1 text-black/40">
                  <Video className="w-6 h-6 mx-auto stroke-1" />
                  <p className="text-xs">No meetings scheduled for this date</p>
                </div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-black/40 text-center font-mono">
            Click any scheduled item to inspect its AI summary
          </div>
        </div>

      </div>
    </div>
  );
}