import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticate, corsHeaders, errorResponse, json, readBody } from '../_shared/context-http.ts';
import { ContextError, requireDb, UUID } from '../_shared/context-utils.ts';
import { indexMeeting } from '../_shared/indexer.ts';

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);
  try {
    const auth = await authenticate(req, true);
    if (!auth.isService && !auth.isAdmin) throw new ContextError('Administrator privileges required.', 403);
    const body = await readBody(req);
    if (body.backfill === true) {
      if (!auth.isAdmin) throw new ContextError('Backfill requires an administrator user session.', 403);
      if (body.cursor && !UUID.test(body.cursor)) throw new ContextError('Invalid backfill cursor.', 400);
      // Bounded, resumable batches avoid a single edge invocation indexing the
      // entire database. Include failed/ready rows: unchanged chunks cost no embeds.
      let query = auth.admin.from('meetings').select('id')
        .in('status', ['summarized', 'completed']).order('id').limit(3);
      if (body.cursor) query = query.gt('id', body.cursor);
      const { data, error } = await query;
      requireDb(error, 'Backfill meeting lookup');
      const batch = (data || []).slice(0, 2);
      const results = await Promise.all(batch.map((m) => indexMeeting(auth.admin, m.id)));
      return json({ success: results.every((r) => r.success), results,
        has_more: (data || []).length > 2, next_cursor: batch.at(-1)?.id || null });
    }
    if (!UUID.test(String(body.meeting_id || ''))) throw new ContextError('meeting_id must be a UUID.', 400);
    const result = await indexMeeting(auth.admin, body.meeting_id);
    return json(result, result.success ? 200 : 500);
  } catch (error) { return errorResponse(error); }
});
