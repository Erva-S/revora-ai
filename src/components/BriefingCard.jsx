import React, { useEffect, useState } from 'react';
import { Calendar, User, FileText, CheckCircle2, Clock } from 'lucide-react';

const BriefingCard = ({ meetingId = 1 }) => {
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`http://localhost:5000/api/meetings/${meetingId}/briefing`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load briefing');
        return res.json();
      })
      .then((data) => {
        setBriefing(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
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
      <div className="p-6 rounded-[24px] bg-red-50 border border-red-200 text-red-600 font-medium">
        Error loading briefing context: {error}
      </div>
    );
  }

  return (
    <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-black/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-sky-100 text-[#0084FF] flex items-center justify-center">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-outfit font-bold text-lg text-black">{briefing.title}</h3>
            <p className="text-xs text-black/50 flex items-center gap-1">
              <User className="w-3 h-3 text-black/40" />
              <span>Recipient: {briefing.recipientEmail}</span>
            </p>
          </div>
        </div>

        <span className="px-3 py-1 rounded-full text-xs font-bold bg-sky-50 text-[#0084FF] border border-sky-100 flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Status: {briefing.status}
        </span>
      </div>

      <div className="space-y-3">
        <div className="p-3.5 rounded-xl bg-neutral-50 border border-black/5 text-xs leading-relaxed text-black/80 flex items-start gap-2">
          <FileText className="w-4 h-4 text-[#0084FF] shrink-0 mt-0.5" />
          <div>
            <strong className="text-black font-semibold">Summary Context: </strong>
            {briefing.summaryContext}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-black uppercase tracking-wider mb-2">
            Key Agenda Topics
          </h4>
          <div className="flex flex-wrap gap-2">
            {briefing.keyTopics?.map((topic, index) => (
              <span
                key={index}
                className="px-3 py-1 rounded-lg bg-neutral-100 text-black/80 font-medium text-xs border border-black/5"
              >
                • {topic}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BriefingCard;