export function queueContextIndex(admin: any, meetingId: string): void {
  const failPending = async () => {
    try {
      await admin.from('meetings').update({ context_status: 'failed', context_error: 'Index dispatch failed; retry indexing.' })
        .eq('id', meetingId).eq('context_status', 'pending');
    } catch { console.warn('[Context] Could not save dispatch failure status.'); }
  };
  const work = (async () => {
    try {
      const { error } = await admin.from('meetings').update({ context_status: 'pending', context_error: null }).eq('id', meetingId);
      if (error) { console.warn('[Context] Index scheduling unavailable; apply the context migration.'); return; }
      const url = Deno.env.get('SUPABASE_URL');
      const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !key) { console.warn('[Context] Index dispatch is not configured.'); await failPending(); return; }
      const response = await fetch(`${url.replace(/\/$/, '')}/functions/v1/index-meeting-context`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_id: meetingId }), signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) { console.warn(`[Context] Index dispatch returned HTTP ${response.status}.`); await failPending(); }
      await response.body?.cancel();
    } catch { console.warn('[Context] Background index dispatch failed safely; retry with backfill.'); await failPending(); }
  })();
  try {
    const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
  } catch { console.warn('[Context] Background scheduling unavailable.'); }
  // No await: the meeting response and its status never depend on indexing.
}
