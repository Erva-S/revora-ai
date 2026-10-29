import React, { useState } from 'react';
import { Sparkles, CheckSquare, X, Copy, Check, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export default function TaskExtractorModal({ isOpen, onClose }) {
  const [transcript, setTranscript] = useState('');
  const [tasks, setTasks] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleExtract = async () => {
    if (!transcript.trim()) return;
    setLoading(true);
    setTasks('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/meetings/extract-tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript }),
      });

      const data = await res.json();
      if (res.ok) {
        setTasks(data.tasks);
      } else {
        setTasks('Failed to extract tasks. Please check your server.');
      }
    } catch (err) {
      console.error('Task extraction error:', err);
      setTasks('Error connecting to backend server.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!tasks) return;
    navigator.clipboard.writeText(tasks);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[28px] max-w-2xl w-full p-6 shadow-2xl border border-black/10 space-y-5 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-black/5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-outfit font-bold text-lg text-black">AI Post-Meeting Task Extractor</h3>
              <p className="text-xs text-black/50">Convert meeting transcripts into action items, assignees, & deadlines</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-black/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input Textarea */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-black/70 block">
            Paste Meeting Notes or Transcript:
          </label>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="e.g. John will optimize the database queries by Friday. Sarah needs to send the revised Q4 marketing budget to leadership."
            className="w-full h-32 p-3.5 rounded-2xl bg-neutral-50 border border-black/10 text-xs text-black placeholder:text-black/30 focus:outline-none focus:border-[#0084FF] transition-all resize-none"
          />
        </div>

        {/* Extract Button */}
        <button
          onClick={handleExtract}
          disabled={loading || !transcript.trim()}
          className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-50 cursor-pointer"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analyzing Transcript with Gemini...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Extract Action Items</span>
            </>
          )}
        </button>

        {/* Output Area */}
        {tasks && (
          <div className="p-4 rounded-2xl bg-purple-50/60 border border-purple-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-xs text-purple-900">Extracted Action Items</span>
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 rounded-lg bg-white border border-purple-200 text-purple-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy Items'}</span>
              </button>
            </div>
            <div className="text-xs text-black/80 prose prose-sm max-w-none">
              <ReactMarkdown>{tasks}</ReactMarkdown>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}