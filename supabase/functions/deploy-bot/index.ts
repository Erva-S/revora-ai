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

function sanitizeKey(rawKey: string | undefined): string {
  if (!rawKey) return '';
  return rawKey.replace(/^["'\s]+|["'\s]+$/g, '').trim();
}

// v2 accepts only these transcription providers and rejects anything else with
// HTTP 400 — which kills the whole deploy, so the bot never even joins. The
// legacy value "Default" (still present in the root .env) is one such value.
// Mirror the reference implementation: normalize, and fall back to gladia.
const V2_STT_PROVIDERS = new Set(['gladia', 'deepgram', 'assemblyai', 'speechmatics', 'soniox']);

function transcriptionProvider(): string {
  const raw = sanitizeKey(Deno.env.get('SPEECH_TO_TEXT_PROVIDER')).toLowerCase();
  if (raw && !V2_STT_PROVIDERS.has(raw)) {
    console.warn(`[Deploy-Bot] SPEECH_TO_TEXT_PROVIDER="${raw}" is not a v2 provider — using gladia instead.`);
  }
  return V2_STT_PROVIDERS.has(raw) ? raw : 'gladia';
}

// Bare origin for the MeetingBaaS REST API. We append the explicit /v2/...
// paths ourselves, so strip any trailing slash or version suffix a value
// like "https://api.meetingbaas.com/v2" might carry.
function meetingBaasBaseUrl(): string {
  const raw = (Deno.env.get('MEETINGBAAS_API_BASE_URL') || 'https://api.meetingbaas.com').trim();
  return raw.replace(/\/+$/, '').replace(/\/v[12]$/i, '');
}

function buildWebhookUrl(): string {
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || 'https://zddythsszyznsguiuiss.supabase.co').replace(/\/$/, '');
  const configuredWebhookUrl = Deno.env.get('MEETINGBAAS_WEBHOOK_URL')?.trim();
  return (configuredWebhookUrl || `${supabaseUrl}/functions/v1/meetingbaas-webhook`).replace(/\/+$/, '');
}

function readResponseError(status: number, rawText: string): string {
  if (!rawText) {
    return `MeetingBaaS request failed with HTTP ${status}`;
  }

  try {
    const parsed = JSON.parse(rawText);
    const parts = [parsed?.error_code, parsed?.error, parsed?.message, parsed?.detail].filter(Boolean);
    if (parts.length > 0) {
      return `MeetingBaaS request failed with HTTP ${status}: ${parts.join(' | ')}`;
    }
  } catch {
    // Fall through to the raw body text.
  }

  return `MeetingBaaS request failed with HTTP ${status}: ${rawText}`;
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

  const rawApiKey = Deno.env.get('MEETINGBAAS_API_KEY');
  const cleanKey = sanitizeKey(rawApiKey);

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

      if (!botId) {
        return json({ success: false, error: 'bot_id URL query parameter is required' }, 200);
      }

      if (cleanKey && !cleanKey.includes('your_meetingbaas')) {
        const headers = { 'x-meeting-baas-api-key': cleanKey };
        // v2: ask the bot to leave. (v1 used DELETE /bots/{id}; v2 exposes an
        // explicit leave action.) This is idempotent by construction: a bot that
        // already left is answered with 404/409, which is not a failure.
        const leaveUrl = `${meetingBaasBaseUrl()}/v2/bots/${botId}/leave`;
        // At most one retry, and only for a server/network problem.
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const leaveResp = await fetch(leaveUrl, { method: 'POST', headers });
            if (leaveResp.ok) {
              console.log(`[MeetingBaaS] Bot leave accepted for bot_id=${botId}.`);
              break;
            }
            const detail = readResponseError(leaveResp.status, await leaveResp.text());
            if (leaveResp.status === 404 || leaveResp.status === 409) {
              console.warn(
                `[MeetingBaaS] Bot ${botId} was not in an active call (HTTP ${leaveResp.status}) - nothing to leave.`
              );
              break;
            }
            console.error(`[MeetingBaaS] Bot leave failed (attempt ${attempt}/2): ${detail}`);
            if (leaveResp.status < 500) break;
          } catch (leaveErr: any) {
            console.error(
              `[MeetingBaaS] Bot leave request error (attempt ${attempt}/2):`,
              leaveErr?.message || String(leaveErr)
            );
          }
        }
      }

      if (SUPABASE_URL && SERVICE_ROLE_KEY) {
        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        await supabaseAdmin
          .from('meetings')
          .update({ ended_at: new Date().toISOString() })
          .eq('bot_id', botId);
      }

      return json({ success: true, message: `Bot ${botId} requested to leave call` }, 200);
    } catch (delErr: any) {
      return json({ success: false, error: delErr.message || 'Failed to remove bot' }, 200);
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
    const sttProvider = transcriptionProvider();
    const botImageUrl = Deno.env.get('BOT_IMAGE_URL')?.trim() || undefined;

    // MeetingBaaS v2 validates timeout_config and rejects the WHOLE create
    // request with HTTP 400 (FST_ERR_VALIDATION, e.g. "Too small: expected
    // number to be >=300" for silence_timeout) when a value is out of range.
    // An out-of-range value therefore does not make the bot leave earlier: it
    // throws away the auto-leave configuration and MeetingBaaS silently keeps
    // its 600s defaults. Clamp every value into the documented range so the
    // auto-leave conditions are always actually in force.
    const clampTimeout = (name: string, fallback: number, min: number, max: number): number => {
      const configured = Number(Deno.env.get(name));
      const value = Number.isFinite(configured) && configured > 0 ? Math.round(configured) : fallback;
      if (value < min || value > max) {
        console.warn(
          `[Deploy-Bot] ${name}=${value}s is outside MeetingBaaS's allowed ${min}-${max}s range - using the nearest valid value.`
        );
      }
      return Math.min(Math.max(value, min), max);
    };

    const waitingRoomTimeout = clampTimeout('BOT_WAITING_ROOM_TIMEOUT', 300, 120, 1800);
    const noOneJoinedTimeout = clampTimeout('BOT_NO_ONE_JOINED_TIMEOUT', 120, 120, 1800);
    // No-audio fallback exit. 300s is the lowest value MeetingBaaS accepts, and
    // it bounds how long an emptied meeting can hold the bot in the call when
    // the roster-based "everyone else has left" exit cannot engage (MeetingBaaS
    // disables that check for the first 5 minutes of recording and needs a
    // healthy speaker observer).
    const silenceTimeout = clampTimeout('BOT_SILENCE_TIMEOUT', 300, 300, 3600);

    // In Google Meet and Teams, the participant roster displays the bot under its bot_name
    // and frequently appends local indicators such as " (You)" or " (Guest)".
    // MeetingBaaS evaluates its "all human participants have left" auto-leave condition
    // by filtering out any attendees matching ignored_participant_names.
    // By ensuring the bot's own identity and common platform variations are always ignored,
    // MeetingBaaS accurately drops to 0 non-ignored participants the moment the last human leaves,
    // triggering automatic departure without lingering.
    const baseBotNames = [
      botName,
      `${botName} (You)`,
      `${botName} (Guest)`,
      'Revora Assistant',
      'Revora Assistant (You)',
      'Revora Assistant (Guest)',
      'AI Meeting Assistant',
      'AI Meeting Assistant (You)',
      'AI Meeting Assistant (Guest)',
    ];
    const envIgnored = (Deno.env.get('BOT_IGNORED_PARTICIPANT_NAMES') || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const ignoredParticipantNames = [...new Set([...baseBotNames, ...envIgnored])];

    console.log(
      `[Deploy-Bot] Auto-leave config: waiting_room_timeout=${waitingRoomTimeout}s ` +
        `no_one_joined_timeout=${noOneJoinedTimeout}s silence_timeout=${silenceTimeout}s ` +
        `ignored_participant_names=${ignoredParticipantNames.join(', ')}`
    );

    // Hybrid dual-compatible payload containing both v1 and v2 property specifications.
    // v1 properties: webhook_url, speech_to_text, automatic_leave (uses noone_joined_timeout)
    // v2 properties: callback_enabled/config, transcription_enabled/config,
    //                timeout_config (uses no_one_joined_timeout, grace_period), ignored_participant_names
    const baasPayload = {
      meeting_url: meetingUrl,
      bot_name: botName,
      recording_mode: 'speaker_view',
      entry_message: entryMessage,
      ...(botImageUrl ? { bot_image: botImageUrl } : {}),
      ...(ignoredParticipantNames.length ? { ignored_participant_names: ignoredParticipantNames } : {}),

      // v1 specification
      webhook_url: webhookUrl,
      speech_to_text: {
        provider: sttProvider,
      },
      automatic_leave: {
        waiting_room_timeout: waitingRoomTimeout,
        noone_joined_timeout: noOneJoinedTimeout,
        no_one_joined_timeout: noOneJoinedTimeout,
        silence_timeout: silenceTimeout,
      },

      // v2 specification
      transcription_enabled: true,
      transcription_config: {
        provider: sttProvider,
      },
      callback_enabled: true,
      callback_config: {
        url: webhookUrl,
        method: 'POST',
        ...(webhookSecret ? { secret: webhookSecret } : {}),
      },
      timeout_config: {
        waiting_room_timeout: waitingRoomTimeout,
        no_one_joined_timeout: noOneJoinedTimeout,
        silence_timeout: silenceTimeout,
        grace_period: 0,
      },
    };

    let botId: string | null = null;
    let dispatchError: string | null = null;

    if (cleanKey && !cleanKey.includes('your_meetingbaas_key_here')) {
      const baseUrl = meetingBaasBaseUrl();
      // Determine primary and secondary endpoints.
      // If MEETINGBAAS_API_BASE_URL explicitly ends with /v1, try v1 first then v2 fallback.
      // Otherwise, default to v2 first (for v2 keys) then v1 fallback.
      const rawEnvUrl = (Deno.env.get('MEETINGBAAS_API_BASE_URL') || '').trim();
      const preferV1 = /\/v1\/?$/i.test(rawEnvUrl);

      const endpoints = preferV1
        ? [`${baseUrl}/v1/bots`, `${baseUrl}/bots`, `${baseUrl}/v2/bots`]
        : [`${baseUrl}/v2/bots`, `${baseUrl}/v1/bots`, `${baseUrl}/bots`];

      const cleanEndpoints = [...new Set(endpoints)];

      for (const endpoint of cleanEndpoints) {
        try {
          console.log(`[Deploy-Bot] POSTing dispatch request to ${endpoint}...`);
          const baasResp = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-meeting-baas-api-key': cleanKey,
            },
            body: JSON.stringify(baasPayload),
          });

          const rawText = await baasResp.text();
          let baasData: any = {};
          try {
            baasData = rawText ? JSON.parse(rawText) : {};
          } catch {
            baasData = { message: rawText };
          }

          if (!baasResp.ok) {
            const errDetail = readResponseError(baasResp.status, rawText);
            console.warn(`[Deploy-Bot Warning] Endpoint ${endpoint} returned HTTP ${baasResp.status}:`, rawText);

            // If we hit wrong platform key or 404, attempt next endpoint fallback in list
            if (
              (baasResp.status === 401 && rawText.includes('WrongPlatformApiKey')) ||
              baasResp.status === 404
            ) {
              dispatchError = errDetail;
              continue;
            }

            dispatchError = errDetail;
            console.error('[Deploy-Bot Error] MeetingBaaS rejected bot request:', {
              endpoint,
              status: baasResp.status,
              body: rawText,
            });
            break;
          } else {
            // Envelope format check: v2 uses data.bot_id, v1 uses bot_id or id directly
            botId = String(baasData?.data?.bot_id || baasData?.bot_id || baasData?.id || '').trim();
            if (!botId) {
              dispatchError = `MeetingBaaS returned HTTP ${baasResp.status} without a valid bot_id: ${rawText || '<empty response>'}`;
              console.error('[Deploy-Bot Error] Missing bot_id in response from:', endpoint);
            } else {
              console.log(`[Deploy-Bot Success] Bot launched via ${endpoint}: bot_id=${botId}`);
              dispatchError = null;
              break;
            }
          }
        } catch (netErr: any) {
          dispatchError = netErr?.message || String(netErr) || 'MeetingBaaS network request failed';
          console.error(`[Deploy-Bot Network Error] Unable to reach ${endpoint}:`, netErr);
        }
      }
    } else {
      dispatchError = 'MEETINGBAAS_API_KEY is missing or invalid';
      console.error('[Deploy-Bot Error] MeetingBaaS API key is not configured');
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
        bot_name: 'Revora Assistant',
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
