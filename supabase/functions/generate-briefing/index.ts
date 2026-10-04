import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { authenticate, corsHeaders, errorResponse, json, readBody } from '../_shared/context-http.ts';
import { ContextError, requireDb, safeError, UUID } from '../_shared/context-utils.ts';
import { briefingPrompt, buildBriefingContext, validateBriefing } from '../_shared/briefing-context.ts';
import type { BriefingScope } from '../_shared/briefing-context.ts';
import { generateJson } from '../_shared/gemini.ts';

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed.' }, 405);
  let auth: Awaited<ReturnType<typeof authenticate>> | null = null;
  let scope: BriefingScope | null = null;
  let row: any = null;
  let ownsGeneration = false;
  try {
    auth = await authenticate(req);
    const body = await readBody(req);
    let target: any = null;
    if (body.meeting_id !== undefined) {
      if (!UUID.test(String(body.meeting_id))) throw new ContextError('meeting_id must be a UUID.', 400);
      // First read is user-scoped: service role is never used to grant target access.
      const result = await auth.user!.from('meetings').select('*').eq('id', body.meeting_id).maybeSingle();
      requireDb(result.error, 'Target meeting lookup');
      if (!result.data) throw new ContextError('Meeting not found or access denied.', 404);
      target = result.data;
      if (!target.project_id) throw new ContextError('Assign this meeting to a project first.', 400);
      if (body.project_id && body.project_id !== target.project_id) throw new ContextError('project_id does not match the target meeting.', 400);
    } else if (!auth.isAdmin) throw new ContextError('Project-level briefings require administrator privileges.', 403);
    const projectId = target?.project_id || body.project_id;
    if (!UUID.test(String(projectId || ''))) throw new ContextError('A valid project_id is required.', 400);
    const scheduled = body.scheduled_for ?? target?.started_at ?? null;
    if (scheduled && !Number.isFinite(Date.parse(scheduled))) throw new ContextError('scheduled_for must be a valid date/time.', 400);
    scope = { projectId, meetingId: target?.id || null, ownerId: target?.user_id || null,
      title: String(body.title ?? target?.title ?? 'Project briefing').slice(0, 200),
      agenda: String(body.agenda ?? '').slice(0, 12000), scheduledFor: scheduled ? new Date(scheduled).toISOString() : null };
    const built = await buildBriefingContext(auth.admin, scope);
    const snapshot = { owner_id: scope.ownerId, project_id: scope.projectId, source_meeting_ids: built.sourceIds,
      task_ids: built.context.open_tasks.map((t) => t.task_id), chunk_ids: built.context.excerpts.map((c) => c.chunk_id),
      token_estimate: built.tokenEstimate, vector_fallback: built.vectorFallback };

    const assertAccess = async () => {
      if (scope!.meetingId) {
        const current = await auth!.user!.from('meetings').select('project_id,user_id').eq('id', scope!.meetingId).maybeSingle();
        if (current.error || !current.data || current.data.project_id !== scope!.projectId || current.data.user_id !== scope!.ownerId)
          throw new ContextError('Meeting access changed; please retry.', 409);
      }
      if (built.sourceIds.length) {
        let query = auth!.admin.from('meetings').select('id').in('id', built.sourceIds).eq('project_id', scope!.projectId);
        if (scope!.meetingId) query = scope!.ownerId ? query.eq('user_id', scope!.ownerId) : query.is('user_id', null);
        const result = await query;
        if (result.error || result.data?.length !== built.sourceIds.length) throw new ContextError('Source access changed; please retry.', 409);
      }
    };
    const lookup = () => {
      let q = auth!.admin.from('briefings').select('*').eq('project_id', scope!.projectId).eq('input_hash', built.inputHash);
      q = scope!.meetingId ? q.eq('meeting_id', scope!.meetingId) : q.is('meeting_id', null);
      return q.maybeSingle();
    };
    const found = await lookup();
    requireDb(found.error, 'Briefing cache lookup');
    row = found.data;
    if (!row) {
      const created = await auth.admin.from('briefings').insert({ project_id: scope.projectId, meeting_id: scope.meetingId,
        title: scope.title, agenda: scope.agenda, scheduled_for: scope.scheduledFor, status: 'generating',
        requested_by: auth.userId, context_snapshot: snapshot, source_meeting_ids: built.sourceIds, input_hash: built.inputHash })
        .select('*').single();
      if (created.error?.code === '23505') {
        const raced = await lookup(); requireDb(raced.error, 'Concurrent briefing lookup'); row = raced.data;
      } else { requireDb(created.error, 'Briefing creation'); row = created.data; ownsGeneration = true; }
    }
    if (!row) throw new ContextError('Unable to acquire briefing generation.');
    if (!ownsGeneration) {
      if (row.status === 'ready' && body.refresh !== true) {
        await assertAccess(); return json({ success: true, cached: true, briefing: row });
      }
      if (row.status === 'generating' && Date.now() - Date.parse(row.updated_at) < 600000) {
        await assertAccess(); return json({ success: true, duplicate: true, briefing: row }, 202);
      }
      const claimed = await auth.admin.from('briefings').update({ status: 'generating', content: null, error_message: null,
        context_snapshot: snapshot, source_meeting_ids: built.sourceIds, requested_by: auth.userId })
        .eq('id', row.id).eq('updated_at', row.updated_at).select('*').maybeSingle();
      requireDb(claimed.error, 'Briefing refresh claim');
      if (!claimed.data) return json({ success: true, duplicate: true, briefing: { id: row.id, status: 'generating' } }, 202);
      row = claimed.data; ownsGeneration = true;
    }
    const generated = await generateJson(briefingPrompt(built.context));
    const content = validateBriefing(generated.value, built.context);
    await assertAccess();
    const saved = await auth.admin.from('briefings').update({ status: 'ready', content, model: generated.model,
      generated_at: new Date().toISOString(), error_message: null }).eq('id', row.id).eq('status', 'generating')
      .eq('updated_at', row.updated_at).select('*').maybeSingle();
    requireDb(saved.error, 'Briefing save');
    if (!saved.data) throw new ContextError('Briefing generation was superseded; reload the latest result.', 409);
    ownsGeneration = false;
    await assertAccess();
    return json({ success: true, cached: false, briefing: saved.data });
  } catch (error) {
    let failedId: string | null = null;
    if (auth && scope) {
      try {
        const patch = { status: 'failed', error_message: safeError(error) };
        if (row && ownsGeneration) {
          const result = await auth.admin.from('briefings').update(patch).eq('id', row.id).eq('status', 'generating').eq('updated_at', row.updated_at).select('id').maybeSingle();
          failedId = result.data?.id || null;
          if (result.error) console.error('[Briefing] Failed to save failure status.');
        } else if (!row) {
          const result = await auth.admin.from('briefings').insert({ ...patch, project_id: scope.projectId, meeting_id: scope.meetingId,
            title: scope.title, agenda: scope.agenda, scheduled_for: scope.scheduledFor, requested_by: auth.userId,
            context_snapshot: { owner_id: scope.ownerId, project_id: scope.projectId } }).select('id').single();
          failedId = result.data?.id || null;
          if (result.error) console.error('[Briefing] Failed to save failure status.');
        }
      } catch { console.error('[Briefing] Failed to save failure status.'); }
    }
    const response = errorResponse(error);
    if (failedId && auth?.user) {
      // A failure caused by reassignment must not return a now-inaccessible snapshot.
      try {
        const failed = await auth.user.from('briefings').select('*').eq('id', failedId).maybeSingle();
        if (failed.data) return json({ success: false, error: safeError(error), briefing: failed.data }, response.status);
      } catch { /* retain the structured failure response */ }
    }
    return response;
  }
});
