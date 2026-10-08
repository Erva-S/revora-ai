export function recordingFailure(http, details = {}, network = false) {
  const code = details.code;
  let status = details.status || 'unavailable';
  let message = details.error;
  if (!message && code === 'VIDEO_NOT_RECORDED') message = 'Only audio is available. Use Watch; an MP4 download is unavailable.';
  if (!message && code === 'RECORDING_NOT_FOUND') message = 'The provider could not find this meeting recording.';
  if (!message && code === 'RECORDING_UNAVAILABLE') message = 'No video recording is available for this meeting.';
  if (http === 401) { status = 'auth_error'; message ||= 'Please sign in again to access this meeting recording.'; }
  else if (http === 403) { status = 'auth_error'; message ||= 'You do not have access to this meeting recording.'; }
  else if (http === 202 || status === 'processing') { status = 'processing'; message ||= 'Recording is still processing. Please try again shortly.'; }
  else if (http === 410 || status === 'expired') { status = 'expired'; message ||= 'The recording has expired or was deleted by the provider.'; }
  else if (code === 'NOT_FOUND' || (http === 404 && !message)) {
    message = 'The recording endpoint is not deployed or its name is incorrect (HTTP 404). Please contact your administrator.';
  } else if (network) { status = 'network_error'; message = 'A network request failed. Check your connection and try again.'; }
  else message ||= `The recording service returned HTTP ${http || 'an invalid response'}. Please contact your administrator.`;
  return { success: false, status, code, http_status: http, error: message };
}

export async function requestRecording(client, meetingId, action, fetcher = globalThis.fetch) {
  let result;
  try { result = await client.functions.invoke('get-meeting-recording', { body: { meeting_id: meetingId, action } }); }
  catch { return recordingFailure(null, {}, true); }
  const { data, error } = result;
  let details = data;
  if (error?.context) {
    try { details = await error.context.json(); } catch { /* network/gateway errors have no JSON body */ }
  }
  if (error || !details?.success) {
    return recordingFailure(error?.context?.status, details || {}, !!error && !error.context && error.name !== 'FunctionsRelayError');
  }
  try {
    const url = new URL(details.url);
    if (url.protocol !== 'https:') throw new Error();
  } catch { return recordingFailure(502, { error: 'The recording service returned an invalid access link.' }); }
  if (action === 'download') {
    // Check the authorized streaming route before handing off to a native
    // download, whose errors are otherwise invisible to application JavaScript.
    let check;
    try { check = await fetcher(details.url, { method: 'HEAD', cache: 'no-store' }); }
    catch { return recordingFailure(null, {}, true); }
    if (!check.ok || check.status === 202 || check.headers.get('content-type')?.split(';')[0] !== 'video/mp4') {
      return recordingFailure(check.status, { code: check.headers.get('x-recording-code'),
        status: check.headers.get('x-recording-status') || undefined,
        ...(check.status === 401 ? { error: 'Download access has expired. Click Download Recording again.' } : {}) });
    }
  }
  return details;
}

/** Native attachment download; no cross-origin download attribute or video blob. */
export function startRecordingDownload(data) {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Meeting recording download';
  const cleanup = () => { clearTimeout(timer); frame.remove(); };
  const timer = setTimeout(cleanup, 10 * 60 * 1000);
  frame.src = data.url;
  document.body.appendChild(frame);
  return cleanup;
}
