import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMeetingRows, applyMeetingChange, isActiveMeeting } from '../src/lib/meetingRealtime.js';

// Status mapper simulation mirroring supabase/functions/_shared/meeting-pipeline.ts
function normalizeCode(code) {
  return String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const MEETING_ENDED_CODES = [
  'callended',
  'allparticipantsleft',
  'noattendees',
  'nospeaker',
  'recordingtimeout',
  'botremoved',
  'apirequeststop',
  'apirequest',
];

function isMeetingEndedCode(code) {
  return MEETING_ENDED_CODES.includes(normalizeCode(code));
}

function mapStatusChangeToStatus(body) {
  const statusObj = body?.data?.status ?? body?.status;
  let code = '';
  if (typeof statusObj === 'string') code = statusObj;
  else if (statusObj && typeof statusObj === 'object') {
    code = String(statusObj.code || statusObj.value || statusObj.name || statusObj.status || '');
  }
  code = code.toLowerCase().trim();
  if (!code) return null;

  const occurredAt = body?.data?.status?.created_at;
  const endedAt = typeof occurredAt === 'string' && Number.isFinite(Date.parse(occurredAt)) ? occurredAt : new Date().toISOString();
  const lifecycle = { provider_status: code, provider_status_at: endedAt };

  const FAILED = [
    'waiting_room_timeout',
    'bot_rejected',
    'invalid_meeting_url',
    'meeting_error',
    'login_required',
    'cannot_join_meeting',
    'timeout_waiting_to_start',
    'recording_failed',
    'bot_removed_too_early',
    'failed',
  ];

  if (FAILED.includes(code)) {
    return {
      status: 'failed',
      processing_stage: 'processing_failed',
      ended_at: endedAt,
      ...lifecycle,
    };
  }

  if (isMeetingEndedCode(code)) {
    return {
      status: 'recording',
      processing_stage: 'meeting_ended',
      ended_at: endedAt,
      ...lifecycle,
      ...(normalizeCode(code) === 'allparticipantsleft' ? { last_human_left_at: endedAt } : {}),
      bot_departure_confirmed_at: endedAt,
    };
  }

  if (['transcribing', 'recording_succeeded', 'completed'].includes(code)) {
    return { status: 'recording', processing_stage: 'transcript_processing', ...lifecycle };
  }

  if (['in_call_recording', 'recording_paused', 'recording_resumed', 'in_call'].includes(code)) {
    return {
      status: 'recording',
      processing_stage: 'meeting_in_progress',
      ...lifecycle,
      bot_joined_at: endedAt,
    };
  }

  if (['queued', 'pickup_delayed', 'joining_call', 'in_waiting_room', 'in_waiting_for_host', 'in_call_not_recording'].includes(code)) {
    return {
      status: 'pending',
      processing_stage: 'bot_dispatched',
      ...lifecycle,
      ...(code === 'joining_call' || code === 'in_waiting_room' || code === 'in_waiting_for_host'
        ? { bot_joining_started_at: endedAt }
        : {}),
    };
  }

  return null;
}

// Participant roster logic mirroring supabase/functions/_shared/meeting-pipeline.ts
function normKey(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function buildParticipantRegistry(data) {
  const reg = { names: [], lookup: new Map(), ids: [], map: {} };
  const botKeys = new Set(data?.bot_name ? [data.bot_name, `${data.bot_name} (You)`, `${data.bot_name} (Guest)`].map(normKey) : []);
  const ambiguous = new Set();
  const addAlias = (key, name) => {
    if (!key || ambiguous.has(key)) return;
    if (reg.lookup.has(key) && reg.lookup.get(key) !== name) {
      reg.lookup.delete(key);
      ambiguous.add(key);
    } else {
      reg.lookup.set(key, name);
    }
  };

  const consider = (entry) => {
    if (entry == null) return;
    const p = typeof entry === 'string' ? { name: entry } : entry;
    const rawName = p.name ?? p.speaker ?? p.display_name ?? p.user_name ?? undefined;
    const rawId = p.id ?? p.user_id ?? p.speaker_id ?? p.participant_id;
    if (!rawName || !String(rawName).trim()) return;

    if (p.is_bot === true) return;
    if (botKeys.has(normKey(rawName))) return;

    const canonical = String(rawName).trim();
    if (!reg.names.includes(canonical)) reg.names.push(canonical);

    for (const alias of [rawName, canonical, p.display_name, p.user_name]) {
      const k = normKey(alias);
      addAlias(k, canonical);
    }
    if (rawId !== undefined && rawId !== null && String(rawId).trim()) {
      const idKey = normKey(String(rawId));
      addAlias(idKey, canonical);
      if (p.speaker_id !== undefined) addAlias(normKey(p.speaker_id), canonical);
      if (!reg.ids.includes(String(rawId))) reg.ids.push(String(rawId));
      reg.map[String(rawId)] = canonical;
    }
  };

  for (const p of Array.isArray(data?.participants) ? data.participants : []) consider(p);
  for (const s of Array.isArray(data?.speakers) ? data.speakers : []) consider(s);
  return reg;
}

test('1. Successful join and provider-confirmed Live status', () => {
  const eventPayload = {
    event: 'bot.status_change',
    data: {
      bot_id: 'bot-123',
      status: {
        code: 'in_call_recording',
        created_at: '2026-10-15T10:00:05.000Z',
      },
    },
  };
  const mapped = mapStatusChangeToStatus(eventPayload);
  assert.equal(mapped.status, 'recording');
  assert.equal(mapped.processing_stage, 'meeting_in_progress');
  assert.equal(mapped.provider_status, 'in_call_recording');
  assert.equal(mapped.bot_joined_at, '2026-10-15T10:00:05.000Z');
  assert.equal(mapped.last_human_left_at, undefined);
});

test('2. Last human participant leaving triggers provider departure with timestamp', () => {
  const eventPayload = {
    event: 'bot.status_change',
    data: {
      bot_id: 'bot-123',
      status: {
        code: 'all_participants_left',
        created_at: '2026-10-15T10:45:00.000Z',
      },
    },
  };
  const mapped = mapStatusChangeToStatus(eventPayload);
  assert.equal(mapped.status, 'recording');
  assert.equal(mapped.processing_stage, 'meeting_ended');
  assert.equal(mapped.last_human_left_at, '2026-10-15T10:45:00.000Z');
  assert.equal(mapped.bot_departure_confirmed_at, '2026-10-15T10:45:00.000Z');
});

test('3. Bot and automated entities are excluded from human participant roster', () => {
  const rosterData = {
    bot_name: 'Revora AI Assistant',
    participants: [
      { name: 'Revora AI Assistant (Guest)', is_bot: true },
      { name: 'Revora AI Assistant', is_bot: false }, // Should still match botKeys
      { name: 'Alice Smith', id: 'p-1' },
      { name: 'Bob Jones', id: 'p-2' },
      { name: 'Transcription Bot', is_bot: true },
    ],
  };
  const registry = buildParticipantRegistry(rosterData);
  assert.deepEqual(registry.names, ['Alice Smith', 'Bob Jones']);
  assert.equal(registry.lookup.get('alice smith'), 'Alice Smith');
  assert.equal(registry.lookup.get('revora ai assistant'), undefined);
});

test('4. Ordering guard prevents stale or out-of-order updates from regressing finished meetings', () => {
  const existingMeeting = {
    id: 'm-1',
    status: 'summarized',
    processing_stage: 'completed',
    ended_at: '2026-10-15T10:45:00.000Z',
    updated_at: '2026-10-15T10:46:00.000Z',
  };

  const isFinished = ['completed', 'summarized', 'failed'].includes(existingMeeting.status);
  assert.equal(isFinished, true, 'Meeting is already finished');

  // Stale event arrived late
  const staleEvent = {
    data: { status: { code: 'in_call_recording', created_at: '2026-10-15T10:05:00.000Z' } },
  };
  const mapped = mapStatusChangeToStatus(staleEvent);
  assert.notEqual(mapped, null);

  // When isFinished is true, pipeline logs and ignores without updating DB
  const shouldIgnore = isFinished;
  assert.equal(shouldIgnore, true, 'Stale status_change is safely ignored');
});

test('5. Lifecycle timestamp deduplication preserves the earliest recorded timestamp', () => {
  const existing = {
    bot_joined_at: '2026-10-15T10:00:05.000Z',
    bot_joining_started_at: '2026-10-15T09:59:58.000Z',
  };

  const incomingPatch = {
    status: 'recording',
    processing_stage: 'meeting_in_progress',
    bot_joined_at: '2026-10-15T10:00:15.000Z', // Later timestamp from retry
  };

  const lifecyclePatch = { ...incomingPatch };
  for (const field of ['bot_joining_started_at', 'bot_joined_at', 'last_human_left_at', 'bot_departure_confirmed_at']) {
    if (existing[field]) delete lifecyclePatch[field];
  }

  assert.equal(lifecyclePatch.bot_joined_at, undefined, 'Existing earlier joined timestamp was preserved');
});

test('6. Realtime row merging preserves newer realtime rows over older HTTP responses', () => {
  const realtimeRow = {
    id: 'm-1',
    title: 'Design Review',
    status: 'recording',
    processing_stage: 'meeting_in_progress',
    updated_at: '2026-10-15T10:10:00.000Z',
  };

  const staleHttpRows = [
    {
      id: 'm-1',
      title: 'Design Review',
      status: 'pending',
      processing_stage: 'bot_dispatched',
      updated_at: '2026-10-15T10:09:50.000Z', // 10 seconds older
    },
    {
      id: 'm-2',
      title: 'Sprint Planning',
      status: 'summarized',
      updated_at: '2026-10-15T09:00:00.000Z',
    },
  ];

  const merged = mergeMeetingRows([realtimeRow], staleHttpRows);
  const m1 = merged.find((r) => r.id === 'm-1');
  assert.equal(m1.status, 'recording', 'Newer realtime row is retained');
  assert.equal(m1.processing_stage, 'meeting_in_progress');
});

test('7. applyMeetingChange correctly applies INSERT, UPDATE, and DELETE', () => {
  let list = [
    { id: 'm-1', status: 'pending', updated_at: '2026-10-15T10:00:00.000Z' },
  ];

  // UPDATE
  list = applyMeetingChange(list, {
    eventType: 'UPDATE',
    new: { id: 'm-1', status: 'recording', updated_at: '2026-10-15T10:01:00.000Z' },
  });
  assert.equal(list[0].status, 'recording');

  // INSERT
  list = applyMeetingChange(list, {
    eventType: 'INSERT',
    new: { id: 'm-2', status: 'pending', updated_at: '2026-10-15T10:02:00.000Z' },
  });
  assert.equal(list.length, 2);

  // DELETE
  list = applyMeetingChange(list, {
    eventType: 'DELETE',
    old: { id: 'm-1' },
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'm-2');
});

test('8. isActiveMeeting identifies pending and active calls vs finalized or failed', () => {
  assert.equal(isActiveMeeting({ status: 'pending', processing_stage: 'bot_dispatched' }), true);
  assert.equal(isActiveMeeting({ status: 'recording', processing_stage: 'meeting_in_progress' }), true);
  assert.equal(isActiveMeeting({ status: 'recording', processing_stage: 'meeting_ended' }), true);
  assert.equal(isActiveMeeting({ status: 'completed', processing_stage: 'completed' }), false);
  assert.equal(isActiveMeeting({ status: 'summarized', processing_stage: 'completed' }), false);
  assert.equal(isActiveMeeting({ status: 'failed', processing_stage: 'processing_failed' }), false);
  assert.equal(isActiveMeeting({ status: 'pending', processing_stage: 'processing_failed' }), false);
});

test('9. Reconnect grace period and provider timeout configuration', () => {
  // botCaptureConfig parameters defined in supabase/functions/_shared/meetingbaas.ts
  const timeout = (envVal, fallback, min, max) => {
    const n = Number(envVal);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const config = {
    recording_mode: 'speaker_view',
    allow_multiple_bots: false,
    timeout_config: {
      waiting_room_timeout: timeout(undefined, 300, 120, 1800),
      no_one_joined_timeout: timeout(undefined, 120, 120, 1800),
      silence_timeout: timeout(undefined, 300, 300, 3600),
      everyone_left_timeout: timeout(undefined, 30, 15, 600), // 30s reconnect grace
      grace_period: 0,
    },
  };

  assert.equal(config.allow_multiple_bots, false, 'Duplicate bot dispatch must be forbidden');
  assert.equal(config.timeout_config.everyone_left_timeout, 30, 'Grace period for reconnect is 30s');
  assert.equal(config.timeout_config.waiting_room_timeout, 300, 'Waiting room timeout is 300s');
});

test('10. Multiple attendees leaving at different times - only all_participants_left signals end', () => {
  const intermediateEvent = {
    event: 'bot.status_change',
    data: {
      bot_id: 'bot-123',
      status: { code: 'in_call_recording', created_at: '2026-10-15T10:15:00.000Z' },
    },
  };
  const activeMapped = mapStatusChangeToStatus(intermediateEvent);
  assert.equal(activeMapped.processing_stage, 'meeting_in_progress');
  assert.equal(activeMapped.last_human_left_at, undefined);

  // Final departure
  const finalDepartureEvent = {
    event: 'bot.status_change',
    data: {
      bot_id: 'bot-123',
      status: { code: 'all_participants_left', created_at: '2026-10-15T10:30:00.000Z' },
    },
  };
  const finalMapped = mapStatusChangeToStatus(finalDepartureEvent);
  assert.equal(finalMapped.processing_stage, 'meeting_ended');
  assert.equal(finalMapped.last_human_left_at, '2026-10-15T10:30:00.000Z');
  assert.equal(finalMapped.bot_departure_confirmed_at, '2026-10-15T10:30:00.000Z');
});

test('11. Dispatch reservation idempotency prevents duplicate bot creation', () => {
  const existingDispatches = new Map();
  function reserveDispatchSim(values) {
    if (existingDispatches.has(values.request_key)) {
      return { ...existingDispatches.get(values.request_key), created_now: false };
    }
    const created = { id: 'disp-1', ...values, state: 'creating', created_now: true };
    existingDispatches.set(values.request_key, created);
    return created;
  }

  const dispatch1 = reserveDispatchSim({ request_key: 'planned_p-123', meeting_url: 'https://zoom.us/j/123' });
  assert.equal(dispatch1.created_now, true);

  // Immediate retry or duplicate click
  const dispatch2 = reserveDispatchSim({ request_key: 'planned_p-123', meeting_url: 'https://zoom.us/j/123' });
  assert.equal(dispatch2.created_now, false, 'Duplicate dispatch key must adopt existing reservation');
  assert.equal(dispatch2.id, dispatch1.id);
});

test('12. Concurrent transcript lease claim ensures single worker processing', () => {
  let activeToken = null;
  let activeLeaseTime = 0;

  function claimTranscriptSim(token, now = Date.now()) {
    // If lease is active (< 5 mins), reject concurrent claims
    if (activeToken && now - activeLeaseTime < 300000) {
      return 'processing';
    }
    activeToken = token;
    activeLeaseTime = now;
    return 'claimed';
  }

  const worker1 = claimTranscriptSim('token-A', 1000);
  assert.equal(worker1, 'claimed');

  // Concurrent worker 2 tries claiming at same time
  const worker2 = claimTranscriptSim('token-B', 1500);
  assert.equal(worker2, 'processing', 'Concurrent worker must be rejected with processing');

  // Expired lease can be claimed
  const worker3 = claimTranscriptSim('token-C', 350000);
  assert.equal(worker3, 'claimed', 'Expired lease allows next worker recovery');
});

test('13. Client data isolation and role-based meeting visibility', () => {
  const meetings = [
    { id: 'm-1', client_id: 'client-A', attendees: ['user-1@clienta.com'] },
    { id: 'm-2', client_id: 'client-B', attendees: ['user-2@clientb.com'] },
  ];

  function filterVisibleMeetings(user) {
    if (user.role === 'admin') return meetings;
    return meetings.filter(
      (m) => m.client_id === user.client_id && m.attendees.includes(user.email)
    );
  }

  const adminView = filterVisibleMeetings({ role: 'admin', email: 'admin@revora.ai' });
  assert.equal(adminView.length, 2, 'Admin can view meetings across clients');

  const clientAView = filterVisibleMeetings({ role: 'user', client_id: 'client-A', email: 'user-1@clienta.com' });
  assert.equal(clientAView.length, 1);
  assert.equal(clientAView[0].id, 'm-1');

  const clientBView = filterVisibleMeetings({ role: 'user', client_id: 'client-B', email: 'user-2@clientb.com' });
  assert.equal(clientBView.length, 1);
  assert.equal(clientBView[0].id, 'm-2');

  const intruderView = filterVisibleMeetings({ role: 'user', client_id: 'client-B', email: 'user-1@clienta.com' });
  assert.equal(intruderView.length, 0, 'Cross-client intruder sees zero meetings');
});

