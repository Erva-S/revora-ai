import React, { useState } from 'react';
import { Video, ExternalLink } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function MeetingRecordingLink({ meeting }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const openRecording = async () => {
    if (loading) return;
    setError('');
    // Open synchronously during the click so popup blockers do not discard the
    // tab while the authenticated request refreshes the four-hour artifact URL.
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setError('Allow a new tab for this site, then retry the recording.'); return; }
    tab.opener = null;
    setLoading(true);
    try {
      const { data, error: requestError } = await supabase.functions.invoke('get-meeting-recording', { body: { meeting_id: meeting.id } });
      if (requestError || !data?.success) {
        let message = data?.error || 'Recording could not be opened. Please retry.';
        try { message = (await requestError?.context?.json())?.error || message; } catch { /* retain safe message */ }
        throw new Error(message);
      }
      const url = new URL(data.url);
      if (url.protocol !== 'https:') throw new Error('The recording URL is invalid.');
      tab.location.replace(url.href);
    } catch (err) {
      tab.close();
      setError(err.message || 'Recording could not be opened.');
    } finally { setLoading(false); }
  };
  return <div>
    <button type="button" onClick={openRecording} disabled={loading}
      className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-[#0084FF]/5 border border-[#0084FF]/20 hover:bg-[#0084FF]/10 transition-colors group disabled:opacity-50 cursor-pointer">
      <span className="flex items-center gap-2.5 text-sm font-bold text-[#0084FF]">
        <Video className="w-4 h-4" />{loading ? 'Opening Recording…' : 'Watch Meeting Recording'}
      </span>
      <ExternalLink className="w-4 h-4 text-[#0084FF]/70 group-hover:text-[#0084FF]" />
    </button>
    {error && <p role="alert" className="mt-2 text-xs text-amber-800">{error}</p>}
  </div>;
}
