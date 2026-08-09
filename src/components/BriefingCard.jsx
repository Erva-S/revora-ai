import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Calendar, User, FileText, CheckCircle2, Clock, Copy, Download, Mail, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const BriefingCard = () => {
  const { user } = useAuth();
  const [briefingData, setBriefingData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user?.email) return;

    setLoading(true);
    fetch(`http://localhost:5000/api/meetings/user-briefing?email=${encodeURIComponent(user.email)}`)
      .then((res) => {
        if (!res.ok) throw new Error('No assigned meeting briefing found');
        return res.json();
      })
      .then((data) => {
        setBriefingData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [user]);

  const handleCopy = () => {
    if (!briefingData?.briefing) return;
    navigator.clipboard.writeText(briefingData.briefing);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!briefingData?.briefing) return;
    const element = document.createElement('a');
    const file = new Blob([briefingData.briefing], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `${briefingData.title.replace(/\s+/g, '_')}_Briefing.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  if (loading) {
    return (
      <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs flex items-center justify-center gap-3 text-black/50 font-medium">
        <Clock className="w-5 h-5 animate-spin text-[#0084FF]" />
        <span>Loading your assigned meeting briefing...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-[24px] bg-neutral-100 border border-black/10 text-black/50 font-medium text-center text-xs">
        No assigned meeting briefings available for <strong className="text-black">{user?.email}</strong>.
      </div>
    );
  }

  return (
    <div className="p-6 rounded-[24px] bg-white border border-black/10 shadow-xs space-y-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-black/5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-sky-100 text-[#0084FF] flex items-center justify-center">
            <Calendar className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-outfit font-bold text-lg text-black">{briefingData.title}</h3>
            <p className="text-xs text-black/50 flex items-center gap-1">
              <User className="w-3 h-3 text-black/40" />
              <span>Attendees: {briefingData.recipientEmail}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-black/70 hover:text-black transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
          </button>

          <button
            onClick={handleDownload}
            className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-black/70 hover:text-black transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>

          <span className="px-3 py-1 rounded-full text-xs font-bold bg-sky-50 text-[#0084FF] border border-sky-100 flex items-center gap-1 ml-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Status: {briefingData.status}
          </span>
        </div>
      </div>

      {/* Formatted Content */}
      <div className="p-5 rounded-2xl bg-neutral-50 border border-black/5 text-xs text-black/80 flex items-start gap-3">
        <FileText className="w-4 h-4 text-[#0084FF] shrink-0 mt-1" />
        <div className="space-y-2 w-full prose prose-sm max-w-none text-black/80">
          <strong className="text-black font-bold text-sm block border-b border-black/5 pb-2">
            Generated Pre-Meeting AI Briefing
          </strong>
          <ReactMarkdown>{briefingData.briefing}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

export default BriefingCard;