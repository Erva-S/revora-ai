// Render persisted turns as paragraphs; the UI never remaps or merges speakers.
export function transcriptParagraphs(meeting) {
  const segments = Array.isArray(meeting?.transcript_segments) ? meeting.transcript_segments : [];
  const turns = segments.filter((segment) => typeof segment?.text === 'string' && segment.text.trim());
  if (turns.length) return turns.map((turn) => `${turn.speaker || 'Unidentified Speaker'}: ${turn.text}`);
  return String(meeting?.transcript || '').split(/\r?\n/).filter((line) => line.trim());
}

export const transcriptDisplayText = (meeting) => transcriptParagraphs(meeting).join('\n\n');
