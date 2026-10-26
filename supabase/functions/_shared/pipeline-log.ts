// Never log provider payloads, credentials, grants, or artifact URLs.
export function scrub(value: unknown): string {
  const text = value instanceof Error ? value.message || value.name : String(value ?? '');
  return text.replace(/(https?:\/\/[^\s)'"\]]+)/g, (url) => url.split('?')[0]);
}

export function pipelineLog(stage: string, meetingId: string | null, botId: string | null, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ stage, meeting_id: meetingId, bot_id: botId, ...fields }));
}

// meetings is selected with '*': keep source artifacts/payloads in service-only storage.
export function meetingEventMetadata(body: Record<string, any>) {
  const data = body.data ?? body;
  const status = data.status;
  return { archive_version: 1, event: body.event ?? body.type ?? 'bot.completed', data: {
    bot_id: data.bot_id,
    ...(status ? { status: typeof status === 'string' ? status : {
      code: status.code, created_at: status.created_at, start_time: status.start_time,
    } } : {}),
    transcription_provider: data.extra?.revora?.transcription_provider ?? data.transcription_provider,
  } };
}
