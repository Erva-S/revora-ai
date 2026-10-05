export async function requestRecording(client, meetingId, action, fetcher = globalThis.fetch) {
  const { data, error } = await client.functions.invoke('get-meeting-recording', { body: { meeting_id: meetingId, action } });
  let details = data;
  if (error?.context) {
    try { details = await error.context.json(); } catch { /* network/gateway errors have no JSON body */ }
  }
  if (error || !details?.success) {
    const message = error?.context?.status === 401 ? 'Please sign in again to access this meeting recording.' : details?.code === 'NOT_FOUND'
      ? 'The recording service is unavailable. Please contact your administrator.'
      : details?.error || 'Could not reach the recording service. Check your connection and try again.';
    return { success: false, status: details?.status || 'error', error: message };
  }
  try {
    const url = new URL(details.url);
    if (url.protocol !== 'https:') throw new Error();
  } catch { return { success: false, status: 'error', error: 'The recording service returned an invalid access link.' }; }
  if (action === 'download') {
    // Check the authorized streaming route before handing off to a native
    // download, whose errors are otherwise invisible to application JavaScript.
    const check = await fetcher(details.url, { method: 'HEAD', cache: 'no-store' });
    if (!check.ok || check.status === 202 || check.headers.get('content-type')?.split(';')[0] !== 'video/mp4') {
      return { success: false, status: check.status === 202 ? 'processing' : 'error', error: check.status === 202
        ? 'Recording is still being processed. Please try again shortly.' : check.status === 403
          ? 'You no longer have access to this recording.' : check.status === 401
            ? 'Download access has expired. Click Download Recording again.'
            : 'The recording download service is unavailable. Please retry or contact your administrator.' };
    }
  }
  return details;
}

/** Native attachment download; no cross-origin download attribute or video blob. */
export function startRecordingDownload(data, onError) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Meeting recording download';
  const origin = window.location.origin;
  const listener = (event) => {
    if (event.origin === origin && event.source === frame.contentWindow &&
        event.data?.type === 'revora-recording-download-error' && event.data.request_id === data.request_id) {
      onError(event.data.error); cleanup();
    }
  };
  const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', listener); frame.remove(); };
  window.addEventListener('message', listener);
  const timer = setTimeout(cleanup, 10 * 60 * 1000);
  frame.src = data.url;
  document.body.appendChild(frame);
  return cleanup;
}
