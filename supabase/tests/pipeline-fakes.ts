// Transport fixture for service RPCs. SQL atomicity/authorization is tested against PostgreSQL separately.
export function pipelineRpc(path: string, body: any, meeting: any, saveRows: (rows: any[]) => void = () => {}, context = true): Response | null {
  if (path.endsWith('/rpc/claim_meeting_transcript')) {
    if (meeting.transcript_processing_token) return Response.json('processing');
    if (!body.p_reprocess && (meeting.status === 'summarized' || meeting.processing_stage === 'completed')) return Response.json('completed');
    meeting.transcript_processing_token = body.p_token;
    return Response.json('claimed');
  }
  if (path.endsWith('/rpc/persist_meeting_transcript')) {
    const turns = body.p_turns;
    if (body.p_token !== meeting.transcript_processing_token) return Response.json({ code: 'LEASE' }, { status: 400 });
    Object.assign(meeting, body.p_patch, { transcript_segments: turns,
      transcript: turns.map((t: any) => `${t.speaker}: ${t.text}`).join('\n'),
      raw_transcription: null, raw_diarization: null, status: 'completed', processing_stage: 'transcript_ready', error_message: null });
    saveRows(turns.map((t: any, i: number) => ({ meeting_id: body.p_meeting_id, speaker: t.speaker, text: t.text,
      turn_index: i, start_seconds: t.start_time, end_seconds: t.end_time,
      ...(context ? { segment_index: i, start_time: t.start_time, end_time: t.end_time } : {}) })));
    return Response.json(body.p_meeting_id);
  }
  return null;
}
