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
): Promise<{ ownerId: string | null; error?: string }> {
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
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
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
      const result = await meetingBaasRequest(`/bots/${botId}/leave`, 'POST');
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

    const meetingUrl = String(payload.meeting_url || payload.meetingUrl || '').trim();
    const title = payload.title ? String(payload.title).slice(0, 200) : 'Revora';

    if (!meetingUrl) {
      return json({ success: false, error: 'meeting_url is required' }, 400);
    }

    const owner = await resolveMeetingOwner(
      SUPABASE_URL,
      AUTHZ_SERVICE_ROLE_KEY,
      auth.userId,
      payload.assign_to_user_id ?? payload.assignToUserId ?? payload.owner_user_id
    );
    if (!owner.ownerId) {
      return json({ success: false, error: owner.error || 'Invalid meeting owner' }, 400);
    }
    const userId: string = owner.ownerId;

    // Optional context assignment is verified before dispatching an external bot.
    const projectId = String(payload.project_id ?? '').trim();
    if (projectId) {
      if (!UUID_PATTERN.test(projectId)) return json({ success: false, error: 'project_id must be a valid UUID' }, 400);
      const projectClient = createClient(SUPABASE_URL, AUTHZ_SERVICE_ROLE_KEY);
      const { data: project, error: projectError } = await projectClient.from('projects').select('id').eq('id', projectId).maybeSingle();
      if (projectError || !project) return json({ success: false, error: 'Project unavailable. Apply the context migration and choose an existing project.' }, 400);
      const { error: columnError } = await projectClient.from('meetings').select('project_id').limit(1);
      if (columnError) return json({ success: false, error: 'Meeting project assignment is not installed yet.' }, 400);
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

    let botId: string | null = null;
    let dispatchError: string | null = null;

    try {
      const result = await meetingBaasRequest('/bots', 'POST', baasPayload, 1);
      const candidate = String(result?.bot_id || '').trim();
      if (!UUID_PATTERN.test(candidate)) throw new ContextError('MeetingBaaS returned no valid bot_id. Check the provider dashboard before retrying.', 502);
      botId = candidate;
    } catch (error) {
      dispatchError = error instanceof ContextError ? error.message : 'MeetingBaaS bot creation failed.';
      console.error(`[Deploy-Bot] ${dispatchError}`);
    }

    if (!botId) {
      if (SUPABASE_URL && SERVICE_ROLE_KEY) {
        try {
          const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
          await supabaseAdmin.from('meetings').insert({
            user_id: userId,
            ...(projectId ? { project_id: projectId } : {}),
            meeting_url: meetingUrl,
            platform: detectPlatform(meetingUrl),
            title: title,
            status: 'failed',
            error_message: dispatchError || 'Failed to dispatch MeetingBaaS bot',
            started_at: new Date().toISOString(),
          });
        } catch (failedDbErr) {
          console.error('[Deploy-Bot Failure DB Error]:', failedDbErr);
        }
      }

      return json(
        {
          success: false,
          error: dispatchError || 'Failed to dispatch MeetingBaaS bot',
          meeting_url: meetingUrl,
          webhook_url: webhookUrl,
        },
        502
      );
    }

    // Persist pending meeting row into Supabase 'meetings' Postgres table
    let meetingId: string | null = null;
    if (SUPABASE_URL && SERVICE_ROLE_KEY) {
      try {
        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        const { data: dbData, error: dbError } = await supabaseAdmin
          .from('meetings')
          .insert({
            user_id: userId,
            ...(projectId ? { project_id: projectId } : {}),
            bot_id: botId,
            meeting_url: meetingUrl,
            platform: detectPlatform(meetingUrl),
            title: title,
            status: 'pending',
            transcription_provider: stt.provider,
            started_at: new Date().toISOString(),
          })
          .select('id, bot_id, status')
          .single();

        if (dbError) {
          console.error('[Deploy-Bot DB Error]:', dbError);
        } else if (dbData) {
          meetingId = dbData.id;
        }
      } catch (dbErr) {
        console.error('[Deploy-Bot DB Exception]:', dbErr);
      }
    }

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
      },
      200
    );
  } catch (err: any) {
    console.error('[Deploy-Bot Fatal Exception]:', err);
    return json({ success: false, error: err.message || 'Internal server error' }, 500);
  }
});
