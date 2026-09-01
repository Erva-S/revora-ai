import React, { useEffect, useState } from 'react';
import { Calendar, User, FileText, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import ActionItemCard from './ActionItemCard';
import { meetingStageLabel, meetingStageClasses } from '../lib/meetingStatus';

/**
 * Shows the most recent real meeting briefing. Everything rendered here comes
 * from the database — when there is no meeting yet we say so rather than
 * displaying sample topics, and action items are rendered as cards (never JSON).
 */
const BriefingCard = ({ meetingId = 1 }) => {
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function loadBriefing() {
      try {
        setLoading(true);
        setError(null);

        let query = supabase.from('meetings').select('*');
        if (typeof meetingId === 'string' && meetingId.length > 10) {
          query = query.eq('id', meetingId);
        }

        const { data, error: dbError } = await query
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (dbError) throw dbError;
        if (isMounted) {
          setMeeting(data ?? null);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err?.message || String(err));
          setLoading(false);
        }
      }
    }

    loadBriefing();

    return () => {
      isMounted = false;
    };
  }, [meetingId]);

  if (loading) {
    return (
      <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs flex items-center justify-center gap-3 text-black/50 font-medium">
        <Clock className="w-5 h-5 animate-spin text-[#0084FF]" />
        <span>Fetching live meeting briefing from database...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-[24px] bg-red-50 border border-red-200 text-red-600 text-xs font-medium flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>Error loading briefing context: {error}</span>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs flex items-center gap-3 text-xs text-black/60 font-medium">
        <Clock className="w-4 h-4 shrink-0 text-[#0084FF]" />
        <span>No meetings recorded yet. Deploy the bot to a call and its briefing will appear here.</span>
      </div>
    );
  }

  const actionItems = Array.isArray(meeting.action_items) ? meeting.action_items : [];

  return (
    <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs space-y-4 font-sans">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-black/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-sky-100 text-[#0084FF] flex items-center justify-center">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-outfit font-bold text-lg text-black">{meeting.title || 'Live Video Meeting'}</h3>
            <p className="text-xs text-black/50 flex items-center gap-1">
              <User className="w-3 h-3 text-black/40" />
              <span className="truncate max-w-[280px]">{meeting.meeting_url || 'Meeting URL unavailable'}</span>
            </p>
          </div>
        </div>

        <span
          className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1 ${meetingStageClasses(meeting)}`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {meetingStageLabel(meeting)}
        </span>
      </div>

      <div className="space-y-3">
        <div className="p-3.5 rounded-xl bg-neutral-50 border border-black/5 text-xs leading-relaxed text-black/80 flex items-start gap-2">
          <FileText className="w-4 h-4 text-[#0084FF] shrink-0 mt-0.5" />
          <div>
            <strong className="text-black font-semibold">Summary Context: </strong>
            {meeting.summary || 'Summary not generated yet for this meeting.'}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-black uppercase tracking-wider mb-2">Action Items</h4>
          {actionItems.length > 0 ? (
            <div className="space-y-2">
              {actionItems.map((item, index) => (
                <ActionItemCard key={index} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-black/50">No action items were committed to in this meeting.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default BriefingCard;
