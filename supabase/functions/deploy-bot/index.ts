// ====================================================================
// REVORA — Edge Function: deploy-bot
//
// 1. Authenticates request JWT token (or extracts user_id)
// 2. Dispatches bot via MeetingBaaS API (https://api.meetingbaas.com/v1/bots)
// 3. Surfaces MeetingBaaS API failures directly so the caller can see the real dispatch error.
// 4. Persists the meeting row only after a bot is successfully created.
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

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const rawApiKey = Deno.env.get('MEETINGBAAS_API_KEY');
  const cleanKey = sanitizeKey(rawApiKey);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://zddythsszyznsguiuiss.supabase.co';
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

  // Handle DELETE request to forcibly eject bot from call
  if (req.method === 'DELETE') {
    try {
      const urlParams = new URL(req.url).searchParams;
      const botId = urlParams.get('bot_id');

      if (!botId) {
        return json({ success: false, error: 'bot_id URL query parameter is required' }, 200);
      }

      if (cleanKey && !cleanKey.includes('your_meetingbaas')) {
        const headers = { 'x-meeting-baas-api-key': cleanKey };
        try {
          await fetch(`https://api.meetingbaas.com/v1/bots/${botId}`, { method: 'DELETE', headers });
          await fetch(`https://api.meetingbaas.com/bots/${botId}`, { method: 'DELETE', headers });
        } catch (_) {}
      }

      if (SUPABASE_URL && SERVICE_ROLE_KEY) {
        const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
        await supabaseAdmin
          .from('meetings')
          .update({ status: 'completed', ended_at: new Date().toISOString() })
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
    let payload: Record<string, any> = {};
    try {
      payload = await req.json();
    } catch {
      return json({ success: false, error: 'Request body must be valid JSON' }, 400);
    }

    const meetingUrl = String(payload.meeting_url || payload.meetingUrl || '').trim();
    const title = payload.title ? String(payload.title).slice(0, 200) : 'Revora AI Assistant Sync';

    if (!meetingUrl) {
      return json({ success: false, error: 'meeting_url is required' }, 400);
    }

    let userId: string | null = null;
    if (SUPABASE_URL && SERVICE_ROLE_KEY) {
      const authHeader = req.headers.get('Authorization') ?? '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (jwt) {
        try {
          const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
          const { data: userData } = await supabaseAdmin.auth.getUser(jwt);
          if (userData?.user) {
            userId = userData.user.id;
          }
        } catch (authErr) {
          console.warn('JWT verification notice:', authErr);
        }
      }
    }

    const webhookUrl = buildWebhookUrl();

    // Keep the payload aligned with the documented v1 create-bot contract.
    const baasPayload = {
      meeting_url: meetingUrl,
      bot_name: 'Revora Assistant',
      recording_mode: 'speaker_view',
      automatic_leave: {
        waiting_room_timeout: 600,
      },
      webhook_url: webhookUrl,
    };

    let botId: string | null = null;
    let dispatchError: string | null = null;

    if (cleanKey && !cleanKey.includes('your_meetingbaas_key_here')) {
      const endpoint = 'https://api.meetingbaas.com/bots';
      try {
        console.log(`[Deploy-Bot] POSTing request to ${endpoint}...`);
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
          dispatchError = readResponseError(baasResp.status, rawText);
          console.error('[Deploy-Bot Error] MeetingBaaS rejected the bot request:', {
            endpoint,
            status: baasResp.status,
            body: rawText,
          });
        } else {
          botId = String(baasData.bot_id || baasData.id || '').trim();
          if (!botId) {
            dispatchError = `MeetingBaaS returned a successful response without a bot_id: ${rawText || '<empty response>'}`;
            console.error('[Deploy-Bot Error] Missing bot_id in MeetingBaaS response:', {
              endpoint,
              status: baasResp.status,
              body: rawText,
            });
          } else {
            console.log(`[Deploy-Bot Success] Real bot launched: bot_id=${botId}`);
          }
        }
      } catch (netErr: any) {
        dispatchError = netErr?.message || String(netErr) || 'MeetingBaaS request failed';
        console.error('[Deploy-Bot Network Error] Unable to reach MeetingBaaS:', netErr);
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
