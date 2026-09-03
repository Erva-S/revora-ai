/**
 * Display labels for meeting progress.
 *
 * `meetings.status` is constrained by the database CHECK
 * (scheduled|pending|recording|completed|summarized|failed), so the webhook
 * writes the finer-grained pipeline stage to `meetings.processing_stage`.
 * The UI prefers the stage when present and falls back to the coarse status.
 */

const STAGE_LABELS = {
  bot_dispatched: 'Bot Dispatched',
  meeting_in_progress: 'Meeting In Progress',
  meeting_ended: 'Meeting Ended',
  recording_retrieved: 'Recording Retrieved',
  transcript_processing: 'Transcript Processing',
  transcript_ready: 'Transcript Ready',
  summary_processing: 'Summary Processing',
  completed: 'Completed',
  processing_failed: 'Processing Failed',
};

const STATUS_LABELS = {
  scheduled: 'Bot Dispatched',
  pending: 'Bot Dispatched',
  recording: 'Meeting In Progress',
  completed: 'Transcript Ready',
  summarized: 'Completed',
  failed: 'Processing Failed',
};

/** Human label for a meeting row. */
export function meetingStageLabel(meeting) {
  if (!meeting) return 'Unknown';
  return STAGE_LABELS[meeting.processing_stage] || STATUS_LABELS[meeting.status] || meeting.status || 'Unknown';
}

/** Tailwind classes for the status pill: done / in-flight / failed. */
export function meetingStageClasses(meeting) {
  const stage = meeting?.processing_stage;
  const failed = stage === 'processing_failed' || meeting?.status === 'failed';
  if (failed) return 'bg-red-100 text-red-700 border-red-300';

  const done = stage === 'completed' || meeting?.status === 'summarized';
  if (done) return 'bg-emerald-100 text-emerald-700 border-emerald-300';

  return 'bg-sky-100 text-[#0084FF] border-sky-300 animate-pulse';
}
