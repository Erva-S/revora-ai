import { supabase } from './supabaseClient.js';

function rowTime(row) {
  const value = Date.parse(row?.updated_at || '');
  return Number.isFinite(value) ? value : 0;
}

/** Keep a newer realtime row when a slower HTTP query returns an older snapshot. */
export function mergeMeetingRows(current = [], incoming = []) {
  const previous = new Map(current.map((row) => [row.id, row]));
  return incoming
    .map((row) => {
      const old = previous.get(row.id);
      return old && rowTime(old) > rowTime(row) ? old : row;
    })
    .sort((a, b) => rowTime(b) - rowTime(a));
}

/** Apply a single authenticated postgres_changes payload without waiting for a refetch. */
export function applyMeetingChange(current = [], payload) {
  if (payload?.eventType === 'DELETE') {
    const id = payload.old?.id;
    return current.filter((row) => row.id !== id);
  }
  if (!payload?.new?.id) return current;
  return mergeMeetingRows(current, [...current.filter((row) => row.id !== payload.new.id), payload.new]);
}

export function isActiveMeeting(meeting) {
  return ['pending', 'recording'].includes(meeting?.status)
    && meeting?.processing_stage !== 'processing_failed';
}

/**
 * Subscribe once and let Supabase handle its websocket reconnects. Callers
 * still resync on SUBSCRIBED/CHANNEL_ERROR because a reconnect can miss the
 * change that happened while the browser was offline.
 */
export function subscribeToMeetingChanges(channelName, { onChange, onStatus, filter } = {}) {
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings', ...(filter ? { filter } : {}) }, (payload) => {
      onChange?.(payload);
    });

  channel.subscribe((status, error) => {
    onStatus?.(status, error || null);
  });

  return () => {
    try { supabase.removeChannel(channel); } catch (_) { /* cleanup is best effort */ }
  };
}
