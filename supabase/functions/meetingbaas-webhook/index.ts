// ====================================================================
// REVORA — Edge Function: meetingbaas-webhook
//
// Public webhook receiver for MeetingBaaS v2 bot events (deploy with
// --no-verify-jwt; MeetingBaaS cannot present a Supabase JWT).
//
//   bot.status_change -> map data.status.code onto our meeting status
//   bot.failed        -> mark the meeting failed with the real error
//   bot.completed     -> fetch the REAL transcript from the signed
//                        `transcription` URL (MeetingBaaS built-in STT), or fall
//                        back to Whisper large-v3 ONLY if that is empty and a
//                        provider key is configured; map speakers using MeetingBaaS
//                        participant metadata & diarization, merge segments
//                        chronologically, run Gemini AI, and persist
//                        meetings + summaries + transcripts + action_items.
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-meeting-baas-api-key, x-mb-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function scrub(v: unknown): string {
  const s = v instanceof Error ? v.message || v.name : String(v ?? '');
  return s.replace(/(https?:\/\/[^\s)'"]+)/g, (u) => {
    const q = u.indexOf('?');
    return q === -1 ? u : `${u.slice(0, q)}?<redacted>`;
  });
}

type TranscriptItem = {
  speaker: string;
  text: string;
};

type ActionItem = {
  task: string;
  assignee: string | null;
  due_date: string | null;
  status: string;
};

type AIAnalysis = {
  executive_summary: string;
  key_decisions: string[];
  sentiment: 'positive' | 'neutral' | 'negative' | 'mixed';
  action_items: ActionItem[];
};

type NormalizedTranscript = {
  segments: Array<{ speaker: string; start: number | null; end: number | null; text: string }>;
  text: string;
  speakers: string[];
  durationSecs: number | null;
  isEmpty: boolean;
  metrics: {
    audioDurationSecs: number | null;
    numChunks: number;
    segmentsPerChunk: number[];
    totalWhisperSegments: number;
    speakerIdsDetected: any[];
    speakerMap: Record<string, string>;
    finalLinesCount: number;
    segmentsDiscardedCount: number;
  };
};

type SpeakerMetadata = {
  humanParticipants: string[];
  idToNameMap: Map<string | number, string>;
  rawSpeakerIdsDetected: any[];
};

// --------------------------------------------------------------------
// Signed-artifact fetch
// --------------------------------------------------------------------
async function fetchSignedJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.error(`[Webhook] transcript artifact fetch failed: HTTP ${res.status}`);
      return null;
    }
    const raw = await res.text();
    return raw ? JSON.parse(raw) : null;
  } catch (err: any) {
    console.error('[Webhook] transcript artifact fetch error:', scrub(err));
    return null;
  }
}

// --------------------------------------------------------------------
// Fetch Diarization Timeline (JSON / JSONL)
// --------------------------------------------------------------------
async function fetchDiarizationTimeline(
  diarizationUrl: string | null
): Promise<Array<{ start: number; end: number; speakerId: any; speakerName?: string }>> {
  if (!diarizationUrl) return [];
  try {
    const res = await fetch(diarizationUrl, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.trim()) return [];

    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const timeline: Array<{ start: number; end: number; speakerId: any; speakerName?: string }> = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const start = Number(item.start ?? item.start_time ?? item.offset ?? 0);
        const end = Number(item.end ?? item.end_time ?? start + 1);
        // MeetingBaaS diarization JSONL uses `speaker` for the real participant NAME
        // (e.g. "Ridhhi Thummar") and `user_id` for the numeric cluster id. Other/older
        // formats use `speaker` as a numeric id, so classify by shape rather than assume.
        const rawSpeaker = item.speaker;
        const rawSpeakerIsName = typeof rawSpeaker === 'string' && !/^\d+$/.test(rawSpeaker.trim());
        const speakerName =
          item.speaker_name ?? item.name ?? item.user_name ?? (rawSpeakerIsName ? rawSpeaker : undefined);
        const speakerId = item.speaker_id ?? item.user_id ?? item.id ?? (rawSpeakerIsName ? undefined : rawSpeaker);
        if (Number.isFinite(start)) {
          timeline.push({ start, end, speakerId, speakerName });
        }
      } catch (_) {
        // Ignore unparseable line
      }
    }
    return timeline;
  } catch (err) {
    console.warn('[Webhook] Diarization timeline fetch notice:', scrub(err));
    return [];
  }
}

// --------------------------------------------------------------------
// OpenAI Whisper large-v3 Model Transcriber (NVIDIA / Groq / HF / OpenAI)
// Supports multi-chunk audio processing for long meetings
// --------------------------------------------------------------------
type WhisperFetchResult = {
  rawSegments: any[];
  numChunks: number;
  segmentsPerChunk: number[];
  totalSegments: number;
  audioDurationSecs: number | null;
};

async function transcribeWithWhisperLargeV3(audioUrl: string): Promise<WhisperFetchResult | null> {
  console.log(`[Whisper large-v3] Fetching audio binary from ${scrub(audioUrl)}...`);
  try {
    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(120000) });
    if (!audioRes.ok) {
      console.warn(`[Whisper large-v3] Audio fetch HTTP status ${audioRes.status}`);
      return null;
    }
    const audioBlob = await audioRes.blob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    const sizeMB = (totalBytes / (1024 * 1024)).toFixed(2);
    console.log(`[Whisper large-v3] Downloaded audio file: size=${sizeMB} MB, type=${audioBlob.type}`);

    const MAX_CHUNK_BYTES = 20 * 1024 * 1024; // 20 MB safe chunk limit (API limit is 25 MB)
    const numChunks = Math.max(1, Math.ceil(totalBytes / MAX_CHUNK_BYTES));

    console.log(`[Whisper Pipeline] Audio duration: processing ${sizeMB} MB across ${numChunks} audio chunk(s).`);

    const NVIDIA_API_KEY = Deno.env.get('NVIDIA_API_KEY')?.trim() || Deno.env.get('NV_API_KEY')?.trim();
    const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')?.trim();
    const HF_API_KEY = Deno.env.get('HUGGINGFACE_API_KEY')?.trim() || Deno.env.get('HF_TOKEN')?.trim();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')?.trim();

    const allRawSegments: any[] = [];
    const segmentsPerChunk: number[] = [];
    let maxEndSecs = 0;

    for (let chunkIdx = 0; chunkIdx < numChunks; chunkIdx++) {
      const startByte = chunkIdx * MAX_CHUNK_BYTES;
      const endByte = Math.min(totalBytes, (chunkIdx + 1) * MAX_CHUNK_BYTES);
      const chunkBuffer = arrayBuffer.slice(startByte, endByte);
      const chunkBlob = new Blob([chunkBuffer], { type: audioBlob.type || 'audio/mp3' });
      const chunkOffsetSecs = chunkIdx * 600; // estimated offset per chunk (~10 mins)

      console.log(`[Whisper Pipeline] Transcribing chunk ${chunkIdx + 1}/${numChunks} (${(chunkBlob.size / (1024 * 1024)).toFixed(2)} MB)...`);

      let chunkSegments: any[] = [];

      // 1. NVIDIA API (openai/whisper-large-v3 model)
      if (NVIDIA_API_KEY && chunkSegments.length === 0) {
        console.log('[Whisper large-v3] Executing NVIDIA API with model: openai/whisper-large-v3...');
        const formData = new FormData();
        formData.append('file', chunkBlob, `meeting_chunk_${chunkIdx}.mp3`);
        formData.append('model', 'openai/whisper-large-v3');
        formData.append('response_format', 'verbose_json');

        const nvEndpoints = [
          'https://integrate.api.nvidia.com/v1/audio/transcriptions',
          'https://ai.api.nvidia.com/v1/audio/transcriptions',
        ];

        for (const nvEp of nvEndpoints) {
          try {
            const nvRes = await fetch(nvEp, {
              method: 'POST',
              headers: { Authorization: `Bearer ${NVIDIA_API_KEY}` },
              body: formData,
            });

            if (nvRes.ok) {
              const nvData = await nvRes.json();
              console.log('[Whisper large-v3] NVIDIA API transcription chunk completed.');
              const rawSegs = nvData?.segments || (nvData?.text ? [{ text: nvData.text }] : []);
              chunkSegments = Array.isArray(rawSegs) ? rawSegs : [];
              break;
            }
          } catch (nvErr) {
            console.warn('[Whisper large-v3] NVIDIA API endpoint error:', nvErr);
          }
        }
      }

      // 2. Groq Audio API (whisper-large-v3 model)
      if (GROQ_API_KEY && chunkSegments.length === 0) {
        console.log('[Whisper large-v3] Executing Groq API with model: whisper-large-v3...');
        const formData = new FormData();
        formData.append('file', chunkBlob, `meeting_chunk_${chunkIdx}.mp3`);
        formData.append('model', 'whisper-large-v3');
        formData.append('response_format', 'verbose_json');

        try {
          const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
            body: formData,
          });

          if (groqRes.ok) {
            const groqData = await groqRes.json();
            console.log('[Whisper large-v3] Groq transcription chunk completed.');
            const rawSegs = groqData?.segments || (groqData?.text ? [{ text: groqData.text }] : []);
            chunkSegments = Array.isArray(rawSegs) ? rawSegs : [];
          } else {
            console.warn(`[Whisper large-v3] Groq API returned status ${groqRes.status}`);
          }
        } catch (gErr) {
          console.warn('[Whisper large-v3] Groq API error:', gErr);
        }
      }

      // 3. Hugging Face Inference API (openai/whisper-large-v3 model)
      if (HF_API_KEY && chunkSegments.length === 0) {
        console.log('[Whisper large-v3] Executing HuggingFace API with model: openai/whisper-large-v3...');
        try {
          const hfRes = await fetch('https://api-inference.huggingface.co/models/openai/whisper-large-v3', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${HF_API_KEY}`,
              'Content-Type': 'audio/mpeg',
            },
            body: chunkBlob,
          });

          if (hfRes.ok) {
            const hfData = await hfRes.json();
            console.log('[Whisper large-v3] HuggingFace transcription chunk completed.');
            const rawSegs = hfData?.chunks || hfData?.segments || (hfData?.text ? [{ text: hfData.text }] : []);
            chunkSegments = Array.isArray(rawSegs) ? rawSegs : [];
          } else {
            console.warn(`[Whisper large-v3] HuggingFace API returned status ${hfRes.status}`);
          }
        } catch (hfErr) {
          console.warn('[Whisper large-v3] HuggingFace API error:', hfErr);
        }
      }

      // 4. OpenAI Audio API (whisper-1 model with whisper-large-v3 backend)
      if (OPENAI_API_KEY && chunkSegments.length === 0) {
        console.log('[Whisper large-v3] Executing OpenAI API with model: whisper-1 (whisper-large-v3 backend)...');
        const formData = new FormData();
        formData.append('file', chunkBlob, `meeting_chunk_${chunkIdx}.mp3`);
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'verbose_json');

        try {
          const oaiRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
            body: formData,
          });

          if (oaiRes.ok) {
            const oaiData = await oaiRes.json();
            console.log('[Whisper large-v3] OpenAI API transcription chunk completed.');
            const rawSegs = oaiData?.segments || (oaiData?.text ? [{ text: oaiData.text }] : []);
            chunkSegments = Array.isArray(rawSegs) ? rawSegs : [];
          } else {
            console.warn(`[Whisper large-v3] OpenAI API returned status ${oaiRes.status}`);
          }
        } catch (oaiErr) {
          console.warn('[Whisper large-v3] OpenAI API error:', oaiErr);
        }
      }

      segmentsPerChunk.push(chunkSegments.length);

      // Adjust chunk segment timestamps
      for (const seg of chunkSegments) {
        if (typeof seg === 'object' && seg !== null) {
          const s = typeof seg.start === 'number' ? seg.start + chunkOffsetSecs : null;
          const e = typeof seg.end === 'number' ? seg.end + chunkOffsetSecs : null;
          if (e && e > maxEndSecs) maxEndSecs = e;
          allRawSegments.push({ ...seg, start: s, end: e });
        }
      }
    }

    return {
      rawSegments: allRawSegments,
      numChunks,
      segmentsPerChunk,
      totalSegments: allRawSegments.length,
      audioDurationSecs: maxEndSecs > 0 ? Math.round(maxEndSecs) : null,
    };
  } catch (err) {
    console.error('[Whisper large-v3] Audio transcription error:', scrub(err));
    return null;
  }
}

// --------------------------------------------------------------------
// Speaker Metadata Extraction & Mapping
// --------------------------------------------------------------------
function buildSpeakerMetadata(data: any, doc: any, body: any): SpeakerMetadata {
  const sources = [
    data?.speakers,
    data?.participants,
    doc?.speakers,
    doc?.participants,
    body?.speakers,
    body?.participants,
    data?.bot?.speakers,
    data?.bot?.participants,
  ];

  const humanParticipants: string[] = [];
  const idToNameMap = new Map<string | number, string>();
  const rawSpeakerIdsDetected: any[] = [];

  for (const src of sources) {
    if (Array.isArray(src) && src.length > 0) {
      for (const item of src) {
        if (!item) continue;
        let id: any = null;
        let name = '';
        let displayName = '';

        if (typeof item === 'string') {
          name = item.trim();
        } else if (typeof item === 'object') {
          id = item.id ?? item.speaker_id ?? item.user_id ?? null;
          name = String(item.name || item.speaker_name || item.user_name || item.user || '').trim();
          displayName = String(item.display_name || item.displayname || '').trim();
          if (item.is_bot || item.is_assistant) continue;
        }

        const lowerName = name.toLowerCase();
        if (
          name &&
          !lowerName.includes('bot') &&
          !lowerName.includes('revora') &&
          !lowerName.includes('assistant') &&
          !lowerName.includes('ai meeting')
        ) {
          if (!humanParticipants.includes(name)) {
            humanParticipants.push(name);
          }

          if (id !== null && id !== undefined) {
            rawSpeakerIdsDetected.push(id);
            idToNameMap.set(String(id), name);
            idToNameMap.set(Number(id), name);
            idToNameMap.set(`speaker_${id}`, name);
            idToNameMap.set(`speaker ${id}`, name);
            idToNameMap.set(`speaker_${Number(id) - 1}`, name); // 0-indexed fallback
          }

          if (displayName) {
            idToNameMap.set(displayName.toLowerCase(), name);
          }
          idToNameMap.set(name.toLowerCase(), name);
        }
      }
    }
  }

  return { humanParticipants, idToNameMap, rawSpeakerIdsDetected };
}

function resolveSpeaker(
  seg: any,
  metadata: SpeakerMetadata,
  diarizationTimeline: Array<{ start: number; end: number; speakerId: any; speakerName?: string }>,
  defaultSpeaker: string = ''
): string {
  const { humanParticipants, idToNameMap } = metadata;

  // 1. Direct speaker attribute on segment
  const raw = seg.speaker ?? seg.speaker_id ?? seg.speaker_name ?? seg.user_name ?? seg.name ?? seg.user;
  if (raw !== undefined && raw !== null && raw !== '') {
    const sStr = String(raw).trim();

    if (idToNameMap.has(sStr)) return idToNameMap.get(sStr)!;
    if (idToNameMap.has(Number(sStr))) return idToNameMap.get(Number(sStr))!;
    if (idToNameMap.has(sStr.toLowerCase())) return idToNameMap.get(sStr.toLowerCase())!;

    const numMatch = sStr.match(/\d+/);
    if (numMatch) {
      const idx = parseInt(numMatch[0], 10);
      if (idToNameMap.has(idx)) return idToNameMap.get(idx)!;
      if (humanParticipants[idx]) return humanParticipants[idx];
      if (humanParticipants[idx - 1]) return humanParticipants[idx - 1];
    }

    if (sStr.toLowerCase() !== 'unknown' && sStr.toLowerCase() !== 'speaker') {
      return sStr;
    }
  }

  // 2. Diarization timeline lookup by timestamps
  const segStart = segmentStart(seg);
  const segEnd = segmentEnd(seg);
  if (segStart !== null && diarizationTimeline.length > 0) {
    const midPoint = segEnd !== null ? (segStart + segEnd) / 2 : segStart;
    const match = diarizationTimeline.find((d) => midPoint >= d.start - 0.5 && midPoint <= d.end + 0.5);
    if (match) {
      if (match.speakerName && idToNameMap.has(match.speakerName.toLowerCase())) {
        return idToNameMap.get(match.speakerName.toLowerCase())!;
      }
      if (match.speakerId !== undefined && match.speakerId !== null) {
        const sStr = String(match.speakerId);
        if (idToNameMap.has(sStr)) return idToNameMap.get(sStr)!;
        if (idToNameMap.has(Number(sStr))) return idToNameMap.get(Number(sStr))!;
      }
      if (match.speakerName && match.speakerName.trim()) {
        return match.speakerName.trim();
      }
    }
  }

  // 3. Single human participant fallback
  if (humanParticipants.length === 1) {
    return humanParticipants[0];
  }

  // 4. Default / Previous Speaker fallback
  if (defaultSpeaker && humanParticipants.includes(defaultSpeaker)) {
    return defaultSpeaker;
  }

  // 5. First Human Participant fallback
  if (humanParticipants.length > 0) {
    return humanParticipants[0];
  }

  return 'Speaker 1';
}

function extractUtterancesFromDoc(doc: any): any[] {
  if (!doc) return [];
  if (Array.isArray(doc)) return doc;

  const candidates = [
    doc?.result?.utterances,
    doc?.utterances,
    doc?.prediction, // Gladia format
    doc?.transcript,
    doc?.transcripts,
    doc?.results,
    doc?.segments,
    doc?.speech_to_text,
    doc?.data?.utterances,
    doc?.data?.transcript,
    doc?.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  if (typeof doc?.transcript === 'string' && doc.transcript.trim()) {
    return [{ text: doc.transcript.trim() }];
  }
  if (typeof doc?.text === 'string' && doc.text.trim()) {
    return [{ text: doc.text.trim() }];
  }

  return [];
}

function segmentText(seg: any): string {
  if (typeof seg === 'string') return seg.trim();
  if (!seg || typeof seg !== 'object') return '';

  const candidates = [
    seg.text,
    seg.transcript,
    seg.transcription,
    seg.message,
    seg.content,
    seg.utterance,
    seg.body,
    seg.sentence,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }

  if (Array.isArray(seg.words) && seg.words.length > 0) {
    return seg.words
      .map((w: any) => (typeof w === 'string' ? w : w?.word ?? w?.text ?? ''))
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function segmentStart(seg: any): number | null {
  if (!seg || typeof seg !== 'object') return null;
  const candidates = [seg.start, seg.start_time, seg.offset];
  const n = candidates.find((v: any) => typeof v === 'number' && Number.isFinite(v));
  return typeof n === 'number' ? n : null;
}

function segmentEnd(seg: any): number | null {
  if (!seg || typeof seg !== 'object') return null;
  if (typeof seg.end === 'number') return seg.end;
  if (typeof seg.end_time === 'number') return seg.end_time;
  if (Array.isArray(seg.words) && seg.words.length > 0) {
    const last = seg.words[seg.words.length - 1];
    if (typeof last?.end === 'number') return last.end;
  }
  return null;
}

// --------------------------------------------------------------------
// Transcript Merging & Normalization Engine
// --------------------------------------------------------------------
function normalizeTranscript(
  rawInput: any,
  data: any,
  body: any,
  diarizationTimeline: Array<{ start: number; end: number; speakerId: any; speakerName?: string }> = [],
  whisperResult: WhisperFetchResult | null = null
): NormalizedTranscript {
  let rawUtterances: any[] = [];
  if (whisperResult && Array.isArray(whisperResult.rawSegments) && whisperResult.rawSegments.length > 0) {
    rawUtterances = whisperResult.rawSegments;
  } else if (Array.isArray(rawInput)) {
    rawUtterances = rawInput;
  } else if (rawInput && typeof rawInput === 'object') {
    rawUtterances = extractUtterancesFromDoc(rawInput);
  }

  const metadata = buildSpeakerMetadata(data, rawInput, body);

  let initialCount = rawUtterances.length;
  let discardedCount = 0;
  const mappedSegments: Array<{ speaker: string; start: number | null; end: number | null; text: string }> = [];

  let lastSpeaker = metadata.humanParticipants[0] || '';

  for (const seg of rawUtterances) {
    const text = segmentText(seg);
    if (!text) {
      discardedCount++;
      continue;
    }

    const speaker = resolveSpeaker(seg, metadata, diarizationTimeline, lastSpeaker);
    lastSpeaker = speaker;

    mappedSegments.push({
      speaker,
      start: segmentStart(seg),
      end: segmentEnd(seg),
      text,
    });
  }

  // Sort segments chronologically by start timestamp
  mappedSegments.sort((a, b) => {
    if (a.start === null || b.start === null) return 0;
    return a.start - b.start;
  });

  // Chronological Merging of Consecutive Segments from Same Speaker
  const mergedSegments: Array<{ speaker: string; start: number | null; end: number | null; text: string }> = [];

  for (const seg of mappedSegments) {
    if (mergedSegments.length === 0) {
      mergedSegments.push({ ...seg });
    } else {
      const prev = mergedSegments[mergedSegments.length - 1];
      const timeGap = seg.start !== null && prev.end !== null ? seg.start - prev.end : 0;

      if (prev.speaker === seg.speaker && timeGap < 4.0) {
        const needsSpace = !/^[.,!?;:]/.test(seg.text) && !prev.text.endsWith('-');
        prev.text = prev.text + (needsSpace ? ' ' : '') + seg.text;
        if (seg.end !== null) {
          prev.end = prev.end !== null ? Math.max(prev.end, seg.end) : seg.end;
        }
      } else {
        mergedSegments.push({ ...seg });
      }
    }
  }

  const speakers = [...new Set(mergedSegments.map((s) => s.speaker))];
  const text = mergedSegments.map((s) => `${s.speaker}: ${s.text}`).join('\n');
  const ends = mergedSegments.map((s) => s.end).filter((v): v is number => typeof v === 'number');
  const durationSecs = whisperResult?.audioDurationSecs ?? (ends.length ? Math.round(Math.max(...ends)) : null);

  const speakerMapObj: Record<string, string> = {};
  metadata.idToNameMap.forEach((v, k) => {
    speakerMapObj[String(k)] = v;
  });

  const metrics = {
    audioDurationSecs: durationSecs,
    numChunks: whisperResult?.numChunks ?? 1,
    segmentsPerChunk: whisperResult?.segmentsPerChunk ?? [initialCount],
    totalWhisperSegments: whisperResult?.totalSegments ?? initialCount,
    speakerIdsDetected: metadata.rawSpeakerIdsDetected,
    speakerMap: speakerMapObj,
    finalLinesCount: mergedSegments.length,
    segmentsDiscardedCount: discardedCount,
  };

  // Structured Log Output as Required
  const sttSource = whisperResult ? 'whisper-large-v3 (fallback)' : 'meetingbaas built-in (gladia)';
  console.log(`[Transcript Pipeline] STT source: ${sttSource}`);
  console.log(`[Transcript Pipeline] audio duration: ${metrics.audioDurationSecs != null ? `${metrics.audioDurationSecs}s` : 'unknown'}`);
  console.log(`[Transcript Pipeline] number of audio chunks: ${metrics.numChunks}`);
  console.log(`[Transcript Pipeline] STT segments returned per chunk: ${JSON.stringify(metrics.segmentsPerChunk)}`);
  console.log(`[Transcript Pipeline] total STT segments: ${metrics.totalWhisperSegments}`);
  console.log(`[Transcript Pipeline] speaker IDs detected: ${JSON.stringify(metrics.speakerIdsDetected)}`);
  console.log(`[Transcript Pipeline] speaker IDs mapped to participant names: ${JSON.stringify(metrics.speakerMap)}`);
  console.log(`[Transcript Pipeline] number of final transcript lines (after merge): ${metrics.finalLinesCount}`);
  console.log(`[Transcript Pipeline] segments discarded (empty/no text): ${metrics.segmentsDiscardedCount > 0 ? `${metrics.segmentsDiscardedCount}` : 'none'}`);

  return {
    segments: mergedSegments,
    text,
    speakers,
    durationSecs,
    isEmpty: mergedSegments.length === 0,
    metrics,
  };
}

// --------------------------------------------------------------------
// Map a v2 bot.status_change code onto our meeting status vocabulary
// --------------------------------------------------------------------
function mapStatusChangeToStatus(
  body: Record<string, any>
): { status: 'pending' | 'recording' | 'failed'; error_message?: string; ended_at?: string } | null {
  const statusObj = body?.data?.status || body?.status;
  let code = '';
  if (typeof statusObj === 'string') {
    code = statusObj;
  } else if (typeof statusObj === 'object' && statusObj !== null) {
    code = String(statusObj.code || statusObj.value || statusObj.name || statusObj.status || '');
  }

  code = code.toLowerCase().trim();
  if (!code) return null;

  const errorMessage =
    body?.data?.error_message || body?.error_message || body?.data?.error || body?.error || null;

  const FAILED = [
    'waiting_room_timeout',
    'bot_rejected',
    'invalid_meeting_url',
    'meeting_error',
    'login_required',
    'cannot_join_meeting',
    'timeout_waiting_to_start',
  ];
  if (FAILED.includes(code)) {
    return {
      status: 'failed',
      error_message: errorMessage ? String(errorMessage) : `MeetingBaaS reported ${code}`,
      ended_at: new Date().toISOString(),
    };
  }

  if (code.includes('recording') || code === 'in_call' || code === 'transcribing' || code === 'in_call_recording') {
    return { status: 'recording' };
  }

  if (
    ['queued', 'joining_call', 'in_waiting_room', 'in_waiting_for_host', 'in_call_not_recording'].includes(code) ||
    code.includes('waiting') ||
    code.includes('joining')
  ) {
    return { status: 'pending' };
  }

  return null;
}

// --------------------------------------------------------------------
// Gemini Analysis over the REAL Final Transcript
// --------------------------------------------------------------------
function cleanJsonResponse(rawText: string): any {
  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json/i, '').replace(/```$/i, '').trim();
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```/i, '').replace(/```$/i, '').trim();
  }
  return JSON.parse(cleaned);
}

function sanitizeDueDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function analyzeTranscript(
  transcriptText: string,
  participants: string[] = []
): Promise<AIAnalysis | null> {
  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
  if (!GEMINI_API_KEY) {
    console.warn('[Webhook] GEMINI_API_KEY is not set — skipping AI summary.');
    return null;
  }

  // Models this API key can actually reach were verified against Google's API:
  // gemini-2.5-flash / gemini-2.0-flash / gemini-1.5-flash all return HTTP 404 for
  // this key ("no longer available"), so they are intentionally excluded. A stale
  // GEMINI_MODEL secret pointing at one of those dead models is dropped rather than
  // wasting a round-trip and burying the working fallbacks.
  const KNOWN_DEAD_MODELS = new Set([
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro',
  ]);
  const WORKING_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3-flash-preview'];
  const configured = Deno.env.get('GEMINI_MODEL')?.trim();
  const geminiModels = [
    ...new Set(
      [configured && !KNOWN_DEAD_MODELS.has(configured) ? configured : null, ...WORKING_MODELS].filter(Boolean)
    ),
  ] as string[];

  const participantInfo =
    participants.length > 0
      ? `Meeting Participants: ${participants.join(', ')}.`
      : 'No explicit participant list provided.';

  const systemPrompt = `You are an expert executive assistant. Analyze this meeting transcript and output a strict JSON object with this structure:
{
  "executive_summary": "A concise paragraph summarizing key meeting discussions",
  "key_decisions": ["Array of specific decisions made during the meeting"],
  "sentiment": "positive | neutral | negative | mixed",
  "action_items": [
    {
      "task": "Imperative task description",
      "assignee": "Name of assigned owner or null",
      "due_date": "YYYY-MM-DD or null",
      "status": "pending"
    }
  ]
}

${participantInfo}

Meeting Transcript:
${transcriptText}`;

  for (const model of geminiModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: systemPrompt }] }],
              generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
            }),
          }
        );

        if (!resp.ok) {
          const transient = resp.status === 429 || resp.status === 500 || resp.status === 503;
          let detail = '';
          try {
            detail = scrub((await resp.text()).slice(0, 200));
          } catch (_) {
            // response body unavailable; status alone is enough to decide
          }
          console.warn(
            `[Webhook] Gemini model ${model} attempt ${attempt} -> HTTP ${resp.status}${detail ? ` (${detail})` : ''}`
          );
          if (transient && attempt < 2) {
            await new Promise((r) => setTimeout(r, 900));
            continue; // retry same model once for transient overload
          }
          break; // non-transient (e.g. 404 dead model) -> move on to the next model
        }

        const data = await resp.json();
        const textPart = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textPart) {
          const reason =
            data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'no_text_returned';
          console.warn(`[Webhook] Gemini model ${model} produced no text (${reason})`);
          break;
        }

        const parsed = cleanJsonResponse(textPart);
        console.log(`[Webhook] Summarized transcript with Gemini model ${model}`);
        return {
          executive_summary: String(parsed.executive_summary || '').trim() || 'No summary was produced.',
          key_decisions: Array.isArray(parsed.key_decisions) ? parsed.key_decisions.map((d: any) => String(d)) : [],
          sentiment: ['positive', 'neutral', 'negative', 'mixed'].includes(parsed.sentiment)
            ? parsed.sentiment
            : 'neutral',
          action_items: Array.isArray(parsed.action_items)
            ? parsed.action_items.map((item: any) => ({
                task: String(item.task || 'Assigned task'),
                assignee: item.assignee ? String(item.assignee) : null,
                due_date: sanitizeDueDate(item.due_date),
                status: 'pending',
              }))
            : [],
        };
      } catch (gErr) {
        console.error(`[Webhook] Gemini API error (${model} attempt ${attempt}):`, scrub(gErr));
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 900));
          continue;
        }
      }
    }
  }

  console.error('[Webhook] All Gemini models failed — AI summary unavailable (transcript preserved).');
  return null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Payload must be valid JSON' }, 400);
  }

  const expectedSecret = (Deno.env.get('MEETINGBAAS_WEBHOOK_SECRET') || '').trim();
  if (expectedSecret) {
    const provided =
      req.headers.get('x-mb-secret') ||
      req.headers.get('x-webhook-secret') ||
      new URL(req.url).searchParams.get('token') ||
      '';
    if (provided !== expectedSecret) {
      console.warn('[Webhook] rejected event: webhook secret mismatch');
      return json({ error: 'Invalid webhook secret' }, 401);
    }
  }

  const eventType = String(body?.event || body?.type || body?.event_type || 'complete').toLowerCase();
  const data = body?.data ?? body;
  const botId = String(body?.bot_id || data?.bot_id || body?.bot?.id || body?.id || '').trim();

  console.log(`[Webhook] event=${eventType} bot_id=${botId || '<none>'}`);

  if (!botId) {
    console.warn('[Webhook] payload missing bot_id — cannot correlate to a meeting');
    return json({ success: true, ignored: 'missing bot_id' }, 200);
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zddythsszyznsguiuiss.supabase.co';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('[Webhook] Supabase service role is not configured — cannot persist.');
    return json({ success: false, error: 'Server not configured' }, 200);
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('id, status, summary, transcript')
    .eq('bot_id', botId)
    .maybeSingle();

  const isTerminal = (s?: string | null) => s === 'summarized';

  try {
    const isCompletion = eventType === 'bot.completed' || eventType === 'complete';
    const isFailure = eventType === 'bot.failed' || eventType === 'failed';

    if (isCompletion) {
      const alreadyHasContent =
        existing?.status === 'summarized' ||
        (existing?.status === 'completed' && (existing?.summary || existing?.transcript));
      if (alreadyHasContent) {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true, status: existing.status }, 200);
      }
      return await handleCompletion(supabaseAdmin, body, data, botId, existing?.id ?? null);
    }

    if (isFailure) {
      if (existing && existing.status === 'summarized') {
        return json({ success: true, event: eventType, bot_id: botId, duplicate: true }, 200);
      }
      const code = data?.error_code ? ` [${data.error_code}]` : '';
      const message =
        (data?.error_message || data?.message || data?.error || 'Bot failed to join or record the meeting.') + code;
      await updateMeetingByBotId(supabaseAdmin, botId, {
        status: 'failed',
        error_message: message,
        ended_at: new Date().toISOString(),
        raw_payload: body,
      });
      return json({ success: true, event: eventType, bot_id: botId, status: 'failed' }, 200);
    }

    const mapped = mapStatusChangeToStatus(body);
    if (mapped && !isTerminal(existing?.status)) {
      await updateMeetingByBotId(supabaseAdmin, botId, { ...mapped, raw_payload: body });
      return json({ success: true, event: eventType, bot_id: botId, status: mapped.status }, 200);
    }
    return json({ success: true, event: eventType, bot_id: botId, status: existing?.status ?? 'unchanged' }, 200);
  } catch (err: any) {
    console.error('[Webhook] processing error:', scrub(err));
    return json({ success: false, error: 'Processing error' }, 200);
  }
});

async function updateMeetingByBotId(
  supabaseAdmin: any,
  botId: string,
  patch: Record<string, any>
): Promise<any | null> {
  const { data: existing } = await supabaseAdmin
    .from('meetings')
    .select('id, transcript, status, summary')
    .eq('bot_id', botId)
    .maybeSingle();

  if (existing) {
    if (patch.transcript !== undefined && existing.transcript) {
      const existingText = String(existing.transcript).trim();
      const newText = String(patch.transcript || '').trim();
      if (newText.length < existingText.length) {
        console.log(
          `[Webhook] Preserving existing longer transcript (${existingText.length} chars vs ${newText.length} chars)`
        );
        patch.transcript = existing.transcript;
      }
    }

    const { data: updated } = await supabaseAdmin
      .from('meetings')
      .update(patch)
      .eq('bot_id', botId)
      .select()
      .maybeSingle();

    return updated;
  }

  const { data: inserted } = await supabaseAdmin
    .from('meetings')
    .insert({ bot_id: botId, ...patch })
    .select()
    .maybeSingle();

  return inserted ?? null;
}

// --------------------------------------------------------------------
// Handle bot.completed: fetch transcript, Whisper large-v3, merge & persist
// --------------------------------------------------------------------
async function handleCompletion(
  supabaseAdmin: any,
  body: Record<string, any>,
  data: Record<string, any>,
  botId: string,
  knownMeetingId: string | null
): Promise<Response> {
  console.log(`[Pipeline Log 1] Processing completed meeting bot_id=${botId}`);

  const recordingUrl = data?.video ?? data?.audio ?? data?.mp3 ?? data?.mp4 ?? null;
  const rawDuration = data?.duration_seconds ?? data?.duration ?? data?.bot?.duration ?? null;
  let durationSecs = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? Math.round(rawDuration) : null;

  if (recordingUrl) {
    console.log(`[Pipeline Log 2] Recording audio/video found: URL=${scrub(recordingUrl)}`);
  } else {
    console.warn('[Pipeline Log 2] No media URL returned in completion payload.');
  }

  let rawSource: any = null;
  let whisperFetchResult: WhisperFetchResult | null = null;

  const transcriptionUrl = typeof data?.transcription === 'string' ? data.transcription : null;
  const diarizationUrl = typeof data?.diarization === 'string' ? data.diarization : null;

  if (transcriptionUrl) {
    console.log('[Webhook] Fetching signed transcript document…');
    rawSource = await fetchSignedJson(transcriptionUrl);
  }

  // If signed transcript is absent or empty, invoke OpenAI Whisper large-v3 on recording URL
  if (recordingUrl && (!rawSource || extractUtterancesFromDoc(rawSource).length === 0)) {
    console.log('[Pipeline Log 3] Transcribing audio with OpenAI Whisper large-v3 (openai/whisper-large-v3) engine...');
    whisperFetchResult = await transcribeWithWhisperLargeV3(recordingUrl);
    if (whisperFetchResult) {
      rawSource = whisperFetchResult.rawSegments;
    }
  }

  if (!rawSource) {
    rawSource =
      data?.transcription ??
      data?.transcript ??
      data?.utterances ??
      body?.transcript ??
      body?.utterances ??
      data?.bot?.transcript ??
      null;
  }

  const diarizationTimeline = await fetchDiarizationTimeline(diarizationUrl);
  const norm = normalizeTranscript(rawSource, data, body, diarizationTimeline, whisperFetchResult);

  if (durationSecs === null && norm.durationSecs !== null) {
    durationSecs = norm.durationSecs;
  }

  // No speech / no transcript: complete honestly, no AI, NO fabricated data.
  if (norm.isEmpty) {
    const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      recording_url: recordingUrl,
      duration_secs: durationSecs,
      ended_at: new Date().toISOString(),
      error_message:
        'Meeting ended, but no transcript content was produced (no speech detected or transcription unavailable).',
      raw_payload: body,
    });
    return json(
      { success: true, event: 'bot.completed', bot_id: botId, status: 'completed', transcript: false, meeting_id: meeting?.id ?? knownMeetingId },
      200
    );
  }

  console.log('[Pipeline Log 5] Saving complete transcript to Supabase (meetings & transcripts tables)...');
  console.log('[Pipeline Log 6] Sending complete transcript to Gemini AI for executive summary & action items...');

  const participants = norm.speakers;
  const analysis = await analyzeTranscript(norm.text, participants);
  const finalTranscriptText = norm.text;

  if (!analysis) {
    console.warn('[Pipeline Warning] AI summarization failed, but complete transcript remains fully saved and visible.');
    const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
      status: 'completed',
      transcript: finalTranscriptText,
      recording_url: recordingUrl,
      duration_secs: durationSecs,
      ended_at: new Date().toISOString(),
      error_message: 'Transcript captured, but AI summarization failed (transcript preserved).',
      raw_payload: body,
    });
    await insertTranscriptRows(supabaseAdmin, meeting?.id ?? knownMeetingId, norm);
    return json(
      { success: true, event: 'bot.completed', bot_id: botId, status: 'completed', summarized: false, meeting_id: meeting?.id ?? knownMeetingId },
      200
    );
  }

  // Full success: real transcript + real summary.
  const meeting = await updateMeetingByBotId(supabaseAdmin, botId, {
    status: 'summarized',
    summary: analysis.executive_summary,
    action_items: analysis.action_items,
    transcript: finalTranscriptText,
    recording_url: recordingUrl,
    duration_secs: durationSecs,
    ended_at: new Date().toISOString(),
    error_message: null,
    raw_payload: body,
  });

  const meetingId = meeting?.id ?? knownMeetingId;
  if (meetingId) {
    const { error: summaryError } = await supabaseAdmin.from('summaries').insert({
      meeting_id: meetingId,
      executive_summary: analysis.executive_summary,
      key_decisions: analysis.key_decisions,
      sentiment: analysis.sentiment,
    });
    if (summaryError) {
      console.error(`[Webhook] summaries insert failed (${summaryError.code}): ${summaryError.message}`);
    }
    await insertTranscriptRows(supabaseAdmin, meetingId, norm);
    if (analysis.action_items.length > 0) {
      const { error: actionError } = await supabaseAdmin.from('action_items').insert(
        analysis.action_items.map((a) => ({
          meeting_id: meetingId,
          task: a.task,
          assignee: a.assignee,
          due_date: a.due_date,
          status: a.status || 'pending',
        }))
      );
      if (actionError) {
        console.error(`[Webhook] action_items insert failed (${actionError.code}): ${actionError.message}`);
      }
    }
  }

  console.log('[Pipeline Log 7] Summary & Action Items successfully saved to database.');

  return json(
    {
      success: true,
      event: 'bot.completed',
      bot_id: botId,
      status: 'summarized',
      meeting_id: meetingId,
      summary: analysis.executive_summary,
      action_items: analysis.action_items,
      metrics: norm.metrics,
    },
    200
  );
}

async function insertTranscriptRows(supabaseAdmin: any, meetingId: string | null, norm: NormalizedTranscript): Promise<void> {
  if (!meetingId || norm.segments.length === 0) return;
  const rows: (TranscriptItem & { meeting_id: string })[] = norm.segments.map((s) => ({
    meeting_id: meetingId,
    speaker: s.speaker,
    text: s.text,
  }));
  const { error } = await supabaseAdmin.from('transcripts').insert(rows);
  if (error) {
    console.error(`[Webhook] transcripts insert failed (${error.code}): ${error.message}`);
  } else {
    console.log(`[Transcript Pipeline] persisted ${rows.length} transcript row(s) to Supabase.`);
  }
}
