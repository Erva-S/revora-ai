// ====================================================================
// REVORA — Edge Function: deploy-bot
//
// 1. AUTHORIZATION (fail-closed): the caller must present a real user JWT and
//    must have profiles.role = 'admin'. Bot deployment is an admin-only
//    operation, so a normal signed-in user calling this endpoint directly gets
//    403 — hiding the button in the UI is not what protects it. Applies to
//    POST (deploy) and DELETE (force the bot to leave) alike.
// 2. Dispatches a bot via the MeetingBaaS v2 API (POST https://api.meetingbaas.com/v2/bots)
//    with recording + transcription + callback + silence-based leave enabled.
// 3. Surfaces MeetingBaaS API failures directly so the caller can see the real dispatch error.
// 4. Persists the meeting row only after a bot is successfully created, owned by
//    the user the admin assigned it to (defaults to the admin themselves).
//
// NOTE: the v1 create-bot fields (webhook_url / automatic_leave / speech_to_text)
// are IGNORED by v2 — that is why a v1-style bot joined but never recorded,
// transcribed, or called back. This function speaks the v2 contract.
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { botCaptureConfig, meetingBaasRequest, meetingBaasTranscriptionConfig, sanitizeKey, transcriptionConfig } from '../_shared/meetingbaas.ts';
import { elevenLabsConfig } from '../_shared/elevenlabs.ts';
import { ContextError } from '../_shared/context-utils.ts';
import { pipelineLog } from '../_shared/pipeline-log.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-meeting-baas-api-key',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('zoom.us')) return 'zoom';
  if (lower.includes('meet.google.com')) return 'google_meet';
  if (lower.includes('teams.microsoft.com') || lower.includes('teams.live.com')) return 'teams';
  return 'video_call';
}

function buildWebhookUrl(): string {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || 'https://zddythsszyznsguiuiss.supabase.co').replace(/\/$/, '');
  const configuredWebhookUrl = Deno.env.get('MEETINGBAAS_WEBHOOK_URL')?.trim();
  return (configuredWebhookUrl || `${supabaseUrl}/functions/v1/meetingbaas-webhook`).replace(/\/+$/, '');
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminCaller =
  | { ok: true; userId: string }
  | { ok: false; response: Response };
type OwnerResolution =
  | { ownerId: string }
  | { ownerId: null; error: string };

type DispatchReservation = {
  id: string;
  request_key: string;
  state: 'creating' | 'created' | 'unknown' | 'failed';
  bot_id?: string | null;
  meeting_id?: string | null;
  planned_link?: 'linked' | 'failed' | null;
  error_message?: string | null;
  created_now?: boolean;
};

function validDispatchKey(value: unknown): string | null {
  const key = String(value ?? '').trim();
  return key && key.length <= 200 ? key : null;
}

async function reserveDispatch(
  supabaseAdmin: any,
  values: Record<string, unknown>,
): Promise<DispatchReservation> {
  const inserted = await supabaseAdmin.from('meeting_bot_dispatches')
    .insert(values)
    .select('id,request_key,state,bot_id,meeting_id,planned_link,error_message')
    .single();
  if (inserted.data) return { ...(inserted.data as DispatchReservation), created_now: true };

  // request_key and planned_meeting_id are both unique. Reading after a
  // conflict makes concurrent/retried browser requests adopt the same
  // reservation rather than POSTing another provider bot.
  if (inserted.error?.code === '23505') {
    const byRequest = await supabaseAdmin.from('meeting_bot_dispatches')
      .select('id,request_key,state,bot_id,meeting_id,planned_link,error_message')
      .eq('request_key', values.request_key)
      .maybeSingle();
    if (byRequest.data) return { ...(byRequest.data as DispatchReservation), created_now: false };
    if (values.planned_meeting_id) {
      const byPlan = await supabaseAdmin.from('meeting_bot_dispatches')
        .select('id,request_key,state,bot_id,meeting_id,planned_link,error_message')
        .eq('planned_meeting_id', values.planned_meeting_id)
        .maybeSingle();
      if (byPlan.data) return { ...(byPlan.data as DispatchReservation), created_now: false };
    }
  }

  throw new ContextError(
    inserted.error?.code && ['42P01', 'PGRST202', 'PGRST204', 'PGRST205'].includes(inserted.error.code)
      ? 'Meeting lifecycle migration is not installed. Apply the latest Supabase migration before deploying a bot.'
      : 'Could not reserve this bot dispatch safely; no provider bot was created.',
    503,
  );
}

async function updateDispatch(supabaseAdmin: any, id: string, patch: Record<string, unknown>) {
  const result = await supabaseAdmin.from('meeting_bot_dispatches').update(patch).eq('id', id);
  if (result.error) pipelineLog('dispatch_reservation_update_failed', null, String(patch.bot_id || ''), {
    http_status: 503, database_code: result.error.code,
  });
  return result;
}

// Bot deployment is admin-only. The caller's role is read from public.profiles
// with the service role (the single trusted source) — never from the request
// body, user_metadata, or anything else the client can set. Anything we cannot
// positively verify is rejected, so a misconfigured deployment fails closed
// instead of silently deploying bots for anonymous callers.
async function requireAdminCaller(
  req: Request,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<AdminCaller> {
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '[Deploy-Bot] SUPABASE_SERVICE_ROLE_KEY is not configured — the caller role cannot be verified, so the request is refused.'
    );
    return {
      ok: false,
      response: json(
        {
          success: false,
          error:
            'Server authorization is not configured (missing service role secret), so bot deployment is disabled.',
        },
        500
      ),
    };
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return {
      ok: false,
      response: json(
        { success: false, error: 'Authentication required: sign in as an administrator first.' },
        401
      ),
    };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  let callerId = '';
  try {
    // An anon/publishable key is a valid project key but resolves to no user,
    // so this is also what stops "call it with the public key" attempts.
    const { data, error } = await supabaseAdmin.auth.getUser(jwt);
    if (error || !data?.user?.id) {
      return {
        ok: false,
        response: json(
          { success: false, error: 'Authentication required: no valid user session on this request.' },
          401
        ),
      };
    }
    callerId = data.user.id;
  } catch (authErr) {
    console.error(
      '[Deploy-Bot] Caller verification failed:',
      authErr instanceof Error ? authErr.message : String(authErr)
    );
    return {
      ok: false,
      response: json({ success: false, error: 'Unable to verify the current session.' }, 401),
    };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .maybeSingle();

  if (profileError) {
    console.error('[Deploy-Bot] Role lookup failed:', profileError.message);
    return {
      ok: false,
      response: json(
        { success: false, error: 'Unable to verify your account role. No bot was deployed.' },
        500
      ),
    };
  }

  if (profile?.role !== 'admin') {
    console.warn(`[Deploy-Bot] Refused bot request from non-admin user ${callerId}.`);
    return {
      ok: false,
      response: json(
        {
          success: false,
          error: 'Admin privileges are required to deploy or control the meeting bot.',
        },
        403
      ),
    };
  }

  return { ok: true, userId: callerId };
}

// An admin may hand the meeting to the user who is allowed to read its results
// (meetings.user_id is the existing ownership column the RLS policies use).
// The id is validated against public.profiles server-side; it is an assignment
// made by an already-verified admin, never an identity claim from the client.
async function resolveMeetingOwner(
  supabaseUrl: string,
  serviceRoleKey: string,
  adminUserId: string,
  requestedOwnerId: unknown
): Promise<OwnerResolution> {
  const candidate = String(requestedOwnerId ?? '').trim();
  if (!candidate || candidate === adminUserId) {
    return { ownerId: adminUserId };
  }

  if (!UUID_PATTERN.test(candidate)) {
    return { ownerId: null, error: 'assign_to_user_id must be a valid user id' };
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return { ownerId: adminUserId };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', candidate)
    .maybeSingle();

  if (error) {
    console.error('[Deploy-Bot] Assigned owner lookup failed:', error.message);
    return { ownerId: null, error: 'Unable to verify the assigned meeting owner.' };
  }

  if (!data?.id) {
    return { ownerId: null, error: 'The assigned meeting owner is not a registered user.' };
  }

  return { ownerId: data.id };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zddythsszyznsguiuiss.supabase.co';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  // Authorization is only ever decided with the real service role key: the anon
  // fallback below cannot read another user's profiles row, so using it here
  // would turn "cannot verify" into "allow".
  const AUTHZ_SERVICE_ROLE_KEY = sanitizeKey(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  // Without the service role we run as anon: we could neither verify the
  // caller's role nor insert a user-owned meetings row past RLS.
  if (!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    console.warn(
      '[Deploy-Bot] SUPABASE_SERVICE_ROLE_KEY secret is not set; bot deployment is refused because ' +
        'the caller role cannot be verified. Set the secret.'
    );
  }

  // Handle DELETE request to forcibly eject bot from call
  if (req.method === 'DELETE') {
    // Ejecting a bot is a meeting control action, so it is admin-only too.
    const ejectAuth = await requireAdminCaller(req, SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY);
    if (!ejectAuth.ok) return ejectAuth.response;

    try {
      const urlParams = new URL(req.url).searchParams;
      const botId = urlParams.get('bot_id');

      if (!botId || !UUID_PATTERN.test(botId)) return json({ success: false, error: 'A valid bot_id UUID is required.' }, 400);
      const leaveRequestedAt = new Date().toISOString();
      const leaveStarted = Date.now();
      const result = await meetingBaasRequest(`/bots/${botId}/leave`, 'POST');
      const leavePatch: Record<string, string> = { bot_leave_requested_at: leaveRequestedAt };
      if (result?.already_left) leavePatch.bot_departure_confirmed_at = leaveRequestedAt;
      const savedLeave = await createClient(SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY)
        .from('meetings').update(leavePatch).eq('bot_id', botId).select('id').maybeSingle();
      if (savedLeave.error) pipelineLog('bot_leave_timestamp_save_failed', null, botId, { http_status: 503, database_code: savedLeave.error.code });
      pipelineLog('bot_leave_requested', savedLeave.data?.id || null, botId, {
        duration_ms: Date.now() - leaveStarted, http_status: 200, leave_trigger_reason: 'admin_eject', already_left: !!result?.already_left,
      });
      // Acceptance is not proof of departure. Only provider lifecycle/completion
      // events set ended_at, and the normal callback still finalizes artifacts.
      return json({ success: true, already_left: !!result?.already_left, message: 'Bot leave request accepted.' }, 200);
    } catch (delErr: any) {
      return json({ success: false, error: delErr instanceof ContextError ? delErr.message : 'Failed to remove bot' }, delErr instanceof ContextError ? delErr.status : 502);
    }
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 200);
  }

  try {
    const auth = await requireAdminCaller(req, SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY);
    if (!auth.ok) return auth.response;

    let payload: Record<string, any> = {};
    try {
      payload = await req.json();
    } catch {
      return json({ success: false, error: 'Request body must be valid JSON' }, 400);
    }

    const dispatchKey = validDispatchKey(payload.dispatch_key ?? payload.dispatchKey);
    if (!dispatchKey && payload.retry_link !== true) {
      return json({ success: false, error: 'dispatch_key is required and must be at most 200 characters.' }, 400);
    }

    const requestedPlannedMeetingId = payload.planned_meeting_id ?? payload.plannedMeetingId;
    const plannedMeetingId = requestedPlannedMeetingId === undefined || requestedPlannedMeetingId === null || requestedPlannedMeetingId === ''
      ? null : String(requestedPlannedMeetingId).trim();
    if (plannedMeetingId && !UUID_PATTERN.test(plannedMeetingId))
      return json({ success: false, error: 'planned_meeting_id must be a valid UUID' }, 400);

    let plannedMeeting: any = null;
    if (plannedMeetingId) {
      // Load and validate the planned row before any external provider call.
      // This read is deliberately service-role-backed because deploy-bot is
      // already admin-only and the row may be a legacy NULL-owner row.
      const plannedClient = createClient(SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY);
      const plannedResult = await plannedClient.from('planned_meetings')
        .select('id,project_id,user_id,title,agenda,scheduled_for,meeting_url,status,linked_meeting_id')
        .eq('id', plannedMeetingId).maybeSingle();
      if (plannedResult.error) {
        console.error('[Deploy-Bot] Planned meeting lookup failed:', plannedResult.error.message);
        return json({ success: false, error: 'Unable to validate the planned meeting. Apply the planned-meetings migration first.' }, 400);
      }
      if (!plannedResult.data) return json({ success: false, error: 'Planned meeting not found.' }, 404);
      plannedMeeting = plannedResult.data;
      if (plannedMeeting.status === 'cancelled')
        return json({ success: false, error: 'This planned meeting is cancelled.' }, 409);
      if (plannedMeeting.status !== 'planned' || plannedMeeting.linked_meeting_id)
        return json({ success: false, error: 'This planned meeting is already linked to a meeting.' }, 409);
      if (!plannedMeeting.project_id)
        return json({ success: false, error: 'The planned meeting has no project assignment.' }, 400);
      if (!plannedMeeting.user_id)
        return json({ success: false, error: 'Assign an owner to this planned meeting before deploying the bot.' }, 400);

      // A provider bot may already be running when the post-insert CAS link
      // fails. Admins can retry only that database link, never dispatch a
      // second provider bot for the same planned row.
      if (payload.retry_link === true) {
        const retryMeetingId = String(payload.meeting_id ?? payload.retry_meeting_id ?? '').trim();
        if (!UUID_PATTERN.test(retryMeetingId))
          return json({ success: false, error: 'A valid meeting_id is required to retry the planned link.' }, 400);
        const retryClient = createClient(SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY);
        const retryMeeting = await retryClient.from('meetings').select('id').eq('id', retryMeetingId).maybeSingle();
        if (retryMeeting.error) return json({ success: false, error: 'Unable to validate the existing meeting for link retry.' }, 400);
        if (!retryMeeting.data) return json({ success: false, error: 'Meeting not found for planned-link retry.' }, 404);
        const { data: linked, error: linkError } = await retryClient.rpc('link_planned_meeting', {
          p_planned_id: plannedMeetingId,
          p_meeting_id: retryMeetingId,
        });
        if (linkError || linked !== true) {
          console.error('[Deploy-Bot] Planned meeting link retry failed:', linkError?.message || 'CAS rejected');
          return json({ success: true, meeting_id: retryMeetingId, planned_link: 'failed' }, 200);
        }
        return json({ success: true, meeting_id: retryMeetingId, planned_link: 'linked' }, 200);
      }
    }

    const meetingUrl = String(payload.meeting_url || payload.meetingUrl || plannedMeeting?.meeting_url || '').trim();

    if (!meetingUrl) {
      return json({ success: false, error: 'meeting_url is required' }, 400);
    }

    const requestedProjectId = String(payload.project_id ?? '').trim();
    if (requestedProjectId) {
      if (!UUID_PATTERN.test(requestedProjectId)) return json({ success: false, error: 'project_id must be a valid UUID' }, 400);
      if (plannedMeeting && requestedProjectId !== plannedMeeting.project_id)
        return json({ success: false, error: 'project_id conflicts with the planned meeting.' }, 400);
    }
    const projectId = plannedMeeting?.project_id || requestedProjectId;

    const requestedOwnerId = payload.assign_to_user_id ?? payload.assignToUserId ?? payload.owner_user_id;
    const requestedOwner = String(requestedOwnerId ?? '').trim();
    const plannedOwnerId = plannedMeeting ? plannedMeeting.user_id : null;
    if (plannedMeeting && requestedOwner && requestedOwner !== plannedOwnerId)
      return json({ success: false, error: 'The assigned owner conflicts with the planned meeting.' }, 400);

    const requestedTitle = payload.title ? String(payload.title).slice(0, 200) : '';
    const title = String(plannedMeeting?.title || requestedTitle || 'Revora').slice(0, 200) || 'Revora';

    if (projectId && !UUID_PATTERN.test(projectId)) return json({ success: false, error: 'project_id must be a valid UUID' }, 400);

    // Owner and project validation are independent after planned-row checks.
    // Do not let an optional context lookup serialize the provider dispatch.
    const ownerPromise = resolveMeetingOwner(
      SUPABASE_URL,
      AUTHZ_SERVICE_ROLE_KEY,
      auth.userId,
      plannedOwnerId ?? requestedOwnerId,
    );
    const projectPromise = projectId
      ? createClient(SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY).from('projects').select('id').eq('id', projectId).maybeSingle()
      : Promise.resolve({ data: { id: null }, error: null });
    const [owner, projectResult] = await Promise.all([ownerPromise, projectPromise]);
    if (!owner.ownerId) return json({ success: false, error: 'error' in owner ? owner.error : 'Invalid meeting owner' }, 400);
    if (projectId && (projectResult.error || !projectResult.data)) {
      return json({ success: false, error: 'Project unavailable. Apply the context migration and choose an existing project.' }, 400);
    }
    const userId: string = owner.ownerId;

    const dispatchRequestedAt = new Date().toISOString();
    const dispatchStarted = Date.now();
    const supabaseAdmin = createClient(SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY);
    const dispatch = await reserveDispatch(supabaseAdmin, {
      request_key: dispatchKey,
      planned_meeting_id: plannedMeetingId,
      requested_by: auth.userId,
      owner_id: userId,
      project_id: projectId || null,
      meeting_url: meetingUrl,
      title,
      platform: detectPlatform(meetingUrl),
      state: 'creating',
    });

    if (dispatch.state === 'created' && dispatch.bot_id && dispatch.meeting_id) {
      pipelineLog('bot_dispatch_duplicate', dispatch.meeting_id, dispatch.bot_id, { duration_ms: Date.now() - dispatchStarted, http_status: 200 });
      return json({ success: true, duplicate: true, bot_id: dispatch.bot_id, meeting_id: dispatch.meeting_id,
        assigned_to: userId, status: 'pending', ...(dispatch.planned_link ? { planned_link: dispatch.planned_link } : {}) }, 200);
    }
    if (dispatch.state === 'creating' && dispatch.id && !dispatch.created_now) {
      // A different request currently owns the provider call. Never issue a
      // second POST while its result is ambiguous or still in flight.
      return json({ success: true, accepted: true, duplicate: true, status: 'dispatching',
        message: 'This meeting is already being dispatched. Wait for its lifecycle update.' }, 202);
    }
    if (dispatch.state === 'unknown' && !dispatch.bot_id) {
      return json({ success: false, error: dispatch.error_message || 'The previous provider request had an unknown result. Reconcile it before retrying.' }, 409);
    }
    if (dispatch.state === 'failed') {
      return json({ success: false, error: dispatch.error_message || 'This dispatch request already failed. Start a new deployment.' }, 409);
    }

    const webhookUrl = buildWebhookUrl();
    const webhookSecret = sanitizeKey(Deno.env.get('MEETINGBAAS_WEBHOOK_SECRET'));
    const botName = Deno.env.get('BOT_NAME')?.trim() || 'Revora Assistant';
    const entryMessage =
      Deno.env.get('BOT_ENTRY_MESSAGE')?.trim() ||
      "Hi, I'm an AI assistant here to take notes for this meeting.";
    const stt = transcriptionConfig();
    // Refuse a new recording if its external transcription cannot be configured.
    const elevenlabs = stt.provider === 'elevenlabs' ? elevenLabsConfig() : null;
    const botImageUrl = Deno.env.get('BOT_IMAGE_URL')?.trim() || undefined;

    // Use the actual v2 contract. Creating on speculative fallback endpoints after
    // a network failure can dispatch a second bot when the first request succeeded.
    const baasPayload = {
      meeting_url: meetingUrl,
      bot_name: botName,
      ...botCaptureConfig(botName),
      entry_message: entryMessage,
      ...(botImageUrl ? { bot_image: botImageUrl } : {}),
      ...meetingBaasTranscriptionConfig(stt),
      callback_enabled: true,
      callback_config: {
        url: webhookUrl,
        method: 'POST',
        ...(webhookSecret ? { secret: webhookSecret } : {}),
      },
      extra: { revora: { bot_name: botName, transcription_provider: stt.provider,
        ...(elevenlabs ? { transcription_model: elevenlabs.model } : {}) } },
    };

    let botId: string | null = dispatch.bot_id || null;
    let dispatchError: string | null = null;

    try {
      if (!botId) {
        const providerStarted = Date.now();
        const result = await meetingBaasRequest('/bots', 'POST', baasPayload, 1);
        const candidate = String(result?.bot_id || '').trim();
        if (!UUID_PATTERN.test(candidate)) throw new ContextError('MeetingBaaS returned no valid bot_id. Check the provider dashboard before retrying.', 502);
        botId = candidate;
        await updateDispatch(supabaseAdmin, dispatch.id, { bot_id: botId, error_message: null });
        pipelineLog('bot_creation_accepted', null, botId, {
          duration_ms: Date.now() - providerStarted, total_dispatch_ms: Date.now() - dispatchStarted,
          http_status: 201,
        });
      }
    } catch (error) {
      dispatchError = error instanceof ContextError ? error.message : 'MeetingBaaS bot creation failed.';
      await updateDispatch(supabaseAdmin, dispatch.id, { state: 'unknown', error_message: dispatchError });
      pipelineLog('bot_creation_unknown', null, botId, {
        duration_ms: Date.now() - dispatchStarted, http_status: 502, terminal_failure_reason: dispatchError,
      });
    }

    if (!botId) {
      return json(
        {
          success: false,
          error: dispatchError || 'Failed to dispatch MeetingBaaS bot',
          meeting_url: meetingUrl,
          webhook_url: webhookUrl,
          dispatch_key: dispatchKey,
        },
        503
      );
    }

    // Persist pending meeting row into Supabase 'meetings' Postgres table
    let meetingId: string | null = null;
    if (SUPABASE_URL && SERVICE_ROLE_KEY) {
      try {
        const { data: dbData, error: dbError } = await supabaseAdmin
          .from('meetings')
          .upsert({
            user_id: userId,
            ...(projectId ? { project_id: projectId } : {}),
            bot_id: botId,
            meeting_url: meetingUrl,
            platform: detectPlatform(meetingUrl),
            title: title,
            transcription_provider: stt.provider,
            status: 'pending',
            processing_stage: 'bot_dispatched',
            bot_creation_requested_at: dispatchRequestedAt,
          }, { onConflict: 'bot_id' })
          .select('id, bot_id, status')
          .single();

        if (dbError) {
          await updateDispatch(supabaseAdmin, dispatch.id, {
            state: 'unknown', bot_id: botId, error_message: 'Provider bot was created but meeting ownership could not be saved.',
          });
          pipelineLog('bot_ownership_save_failed', null, botId, { http_status: 503, duration_ms: Date.now() - dispatchStarted });
        } else if (dbData) {
          meetingId = dbData.id;
          try {
            await supabaseAdmin.rpc('record_meeting_attendees', {
              p_meeting_id: meetingId,
              p_organizer_id: userId,
              p_attendee_emails: [],
            });
          } catch (attendeeErr) {
            console.warn('[deploy-bot] Non-blocking attendee recording warning:', attendeeErr);
          }
        }
      } catch {
        await updateDispatch(supabaseAdmin, dispatch.id, {
          state: 'unknown', bot_id: botId, error_message: 'Provider bot was created but meeting ownership could not be saved.',
        });
        pipelineLog('bot_ownership_save_failed', null, botId, { http_status: 503, duration_ms: Date.now() - dispatchStarted });
      }
    }

    if (!meetingId) return json({ success: false, bot_id: botId, dispatched: true,
      dispatch_key: dispatchKey,
      error: 'The bot was dispatched, but meeting ownership could not be saved. Retry with the same dispatch_key to adopt it; do not create a second bot.' }, 503);

    let plannedLink: 'linked' | 'failed' | undefined;
    if (plannedMeetingId) {
      try {
        const { data: linked, error: linkError } = await supabaseAdmin.rpc('link_planned_meeting', {
          p_planned_id: plannedMeetingId,
          p_meeting_id: meetingId,
        });
        if (linkError || linked !== true) {
          plannedLink = 'failed';
          console.error('[Deploy-Bot] Planned meeting link failed:', linkError?.message || 'CAS rejected');
          pipelineLog('planned_link_failed', meetingId, botId, { http_status: 503 });
        } else {
          plannedLink = 'linked';
        }
      } catch (linkError) {
        plannedLink = 'failed';
        console.error('[Deploy-Bot] Planned meeting link failed:', linkError instanceof Error ? linkError.message : String(linkError));
        pipelineLog('planned_link_failed', meetingId, botId, { http_status: 503 });
      }
    }

    await updateDispatch(supabaseAdmin, dispatch.id, {
      state: 'created', bot_id: botId, meeting_id: meetingId, planned_link: plannedLink || null, error_message: null,
    });
    pipelineLog('bot_dispatch_persisted', meetingId, botId, {
      duration_ms: Date.now() - dispatchStarted, http_status: 200, planned_link: plannedLink || null,
    });

    return json(
      {
        success: true,
        bot_id: botId,
        bot_name: botName,
        recording_mode: 'speaker_view',
        meeting_id: meetingId,
        assigned_to: userId,
        status: 'pending',
        is_simulated: false,
        meeting_url: meetingUrl,
        webhook_url: webhookUrl,
        dispatch_key: dispatchKey,
        ...(plannedLink ? { planned_link: plannedLink } : {}),
      },
      200
    );
  } catch (err: any) {
    pipelineLog('bot_dispatch_failed', null, null, { http_status: 500 });
    return json({ success: false, error: err instanceof ContextError ? err.message : 'Internal server error' }, 500);
  }
});
