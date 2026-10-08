import React, { useEffect, useRef, useState } from 'react';
import { Video, ExternalLink, Download } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { requestRecording, startRecordingDownload } from '../lib/recordingAccess';

export default function MeetingRecordingLink({ meeting }) {
  const [loading, setLoading] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [accessState, setAccessState] = useState(meeting.recording_status || 'pending');
  const [fallbackUrl, setFallbackUrl] = useState('');
  const downloads = useRef([]);
  useEffect(() => () => downloads.current.forEach((cleanup) => cleanup()), []);
  const accessRecording = async (action) => {
    if (loading) return;
    setMessage(''); setError(false);
    const tab = action === 'watch' ? window.open('about:blank', '_blank') : null;
    if (action === 'watch' && !tab) { setMessage('Allow a new tab for this site, then retry the recording.'); setError(true); return; }
    if (tab) tab.opener = null;
    setLoading(action);
    try {
      const data = await requestRecording(supabase, meeting.id, action);
      setAccessState(data.status);
      if (!data.success) { tab?.close(); setMessage(data.error); setError(data.status !== 'processing'); return; }
      if (action === 'watch') { tab.location.replace(data.url); setMessage('Recording is ready.'); }
      else {
        downloads.current.push(startRecordingDownload(data));
        setFallbackUrl(data.fallback_url || '');
        setMessage('Recording download requested. Check your browser’s downloads.');
      }
    } catch {
      tab?.close(); setAccessState('unavailable'); setMessage('The recording action could not be opened. Please retry.'); setError(true);
    } finally { setLoading(''); }
  };
  const stateMessage = {
    pending: 'Recording will be available after the meeting ends and processing completes.',
    recording: 'Recording is in progress. The video will be available after the meeting ends.',
    processing: 'Recording is still being processed. Availability is checked when you open or download it.',
    unavailable: 'MeetingBaaS has not returned a meeting video. Click an action to check again.',
    failed: 'MeetingBaaS reported a recording failure. Click an action to check current availability.',
    expired: 'The recording has expired under the provider’s retention policy.',
  }[meeting.recording_status] || '';
  return <div data-recording-state={accessState}>
    <button type="button" onClick={() => accessRecording('watch')} disabled={!!loading}
      className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0084FF]/5 border border-[#0084FF]/20 hover:bg-[#0084FF]/10 transition-colors group disabled:opacity-50 cursor-pointer">
      <span className="flex items-center gap-2.5 text-sm font-bold text-[#0084FF]">
        <Video className="w-4 h-4" />{loading === 'watch' ? 'Opening Recording…' : 'Watch Meeting Recording'}
      </span>
      <ExternalLink className="w-4 h-4 text-[#0084FF]/70 group-hover:text-[#0084FF]" />
    </button>
    {fallbackUrl && <button type="button" onClick={() => accessRecording('watch')} disabled={!!loading}
      className="mt-2 text-xs font-bold text-[#0084FF] cursor-pointer disabled:opacity-50">
      Open fresh recording directly for a very large download
    </button>}
    <button type="button" onClick={() => accessRecording('download')} disabled={!!loading}
      className="mt-2 w-full flex items-center gap-2.5 p-3.5 rounded-2xl bg-[#0084FF]/5 border border-[#0084FF]/20 hover:bg-[#0084FF]/10 transition-colors text-sm font-bold text-[#0084FF] disabled:opacity-50 cursor-pointer">
      <Download className="w-4 h-4" />{loading === 'download' ? 'Preparing Download…' : 'Download Recording'}
    </button>
    {(message || stateMessage) && <p role={error ? 'alert' : 'status'} className={`mt-2 text-xs ${error ? 'text-amber-800' : 'text-gray-500'}`}>{message || stateMessage}</p>}
  </div>;
}
