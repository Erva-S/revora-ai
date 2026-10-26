import { chunkTranscript, transcriptTurns } from './chunker.ts';
import { embedTexts, embeddingConfig } from './gemini.ts';
import { ContextError, requireDb, safeError, sha256 } from './context-utils.ts';

export async function indexMeeting(admin: any, meetingId: string): Promise<Record<string, unknown>> {
  let lease: string | null = null;
  let observedVersion: string | null = null;
  try {
    const { data: meeting, error } = await admin.from('meetings')
      .select('id,title,started_at,created_at,updated_at,status,transcript,transcript_segments,context_status,context_started_at')
      .eq('id', meetingId).maybeSingle();
    requireDb(error, 'Meeting lookup (apply the context migration first)');
    if (!meeting) throw new ContextError('Meeting not found.', 404);
    if (!['summarized', 'completed'].includes(meeting.status)) throw new ContextError('Meeting transcript is not complete yet.', 409);
    if (meeting.context_status === 'processing' && meeting.context_started_at &&
      Date.now() - Date.parse(meeting.context_started_at) < 600000) return { success: true, duplicate: true, meeting_id: meetingId };

    observedVersion = meeting.updated_at;
    const config = embeddingConfig();
    const chunks = chunkTranscript(transcriptTurns(meeting.transcript_segments, meeting.transcript));
    const date = String(meeting.started_at || meeting.created_at).slice(0, 10);
    const planned = await Promise.all(chunks.map(async (chunk) => {
      const header = `Meeting: ${String(meeting.title || 'Untitled').slice(0, 200)} — ${date}. Speakers: ${chunk.speakers.join(', ')}\n`;
      // Include the embedding header + attribution/timing metadata as well as the
      // required text/model/dimensions/version, so metadata edits invalidate it too.
      const content_hash = await sha256(JSON.stringify([chunk, header, config.model, config.dims]));
      return { ...chunk, content_hash, embedding_model: config.model, input: header + chunk.text };
    }));
    const { data: existing, error: existingError } = await admin.from('transcript_chunks')
      .select('chunk_index,content_hash').eq('meeting_id', meetingId).not('embedding', 'is', null);
    requireDb(existingError, 'Existing chunk lookup');
    const hashes = new Map((existing || []).map((c: any) => [c.chunk_index, c.content_hash]));
    const changed = planned.filter((chunk) => hashes.get(chunk.chunk_index) !== chunk.content_hash);
    if (!changed.length && meeting.context_status === 'ready') {
      const total = await admin.from('transcript_chunks').select('id', { count: 'exact', head: true }).eq('meeting_id', meetingId);
      requireDb(total.error, 'Chunk count verification');
      if (total.count === planned.length) return { success: true, meeting_id: meetingId, status: 'ready',
        chunks: planned.length, embedded: 0, unchanged: planned.length, noop: true };
    }
    const startedAt = new Date().toISOString();
    const staleAt = new Date(Date.now() - 600000).toISOString();
    const { data: claimed, error: claimError } = await admin.from('meetings')
      .update({ context_status: 'processing', context_started_at: startedAt, context_error: null })
      .eq('id', meetingId).eq('updated_at', meeting.updated_at)
      .or(`context_status.is.null,context_status.neq.processing,context_started_at.is.null,context_started_at.lt.${staleAt}`)
      .select('id').maybeSingle();
    requireDb(claimError, 'Index lease acquisition');
    if (!claimed) return { success: true, duplicate: true, meeting_id: meetingId };
    lease = startedAt;
    const embeddings = await embedTexts(changed.map((chunk) => chunk.input), 'RETRIEVAL_DOCUMENT');
    const rows = changed.map(({ input: _input, ...chunk }, i) => ({ ...chunk, embedding: JSON.stringify(embeddings[i]) }));
    const { data: committed, error: commitError } = await admin.rpc('context_commit_chunks', {
      p_meeting_id: meetingId, p_started_at: lease, p_chunks: rows, p_count: planned.length,
    });
    requireDb(commitError, 'Chunk commit');
    return { success: true, meeting_id: meetingId, status: committed ? 'ready' : 'superseded',
      chunks: chunks.length, embedded: changed.length, unchanged: chunks.length - changed.length };
  } catch (error) {
    const message = safeError(error);
    console.error(`[Context Index] meeting=${meetingId} ${message}`);
    if (lease || observedVersion) {
      try {
        let update = admin.from('meetings')
          .update({ context_status: 'failed', context_error: message })
          .eq('id', meetingId);
        update = lease ? update.eq('context_status', 'processing').eq('context_started_at', lease) : update.eq('updated_at', observedVersion);
        const { error: statusError } = await update;
        if (statusError) console.error('[Context Index] Failed to persist index failure status.');
      } catch { console.error('[Context Index] Failed to persist index failure status.'); }
    }
    return { success: false, meeting_id: meetingId, status: 'failed', error: message };
  }
}
