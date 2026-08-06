import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-meeting-baas-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { meetingUrl, meeting_url } = await req.json();
    const targetUrl = meetingUrl || meeting_url;

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'meetingUrl is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Securely retrieve MeetingBaaS API Key from secrets
    const MEETINGBAAS_API_KEY = Deno.env.get('MEETINGBAAS_API_KEY');

    if (!MEETINGBAAS_API_KEY) {
      console.warn('MEETINGBAAS_API_KEY environment variable is not set. Operating in fallback preview mode.');
      return new Response(
        JSON.stringify({
          success: true,
          bot_id: `bot_baas_mock_${Math.random().toString(36).substring(2, 9)}`,
          bot_name: 'Revora Assistant',
          recording_mode: 'speaker_view',
          meeting_url: targetUrl,
          message: 'Revora Assistant scheduled (mock mode: set MEETINGBAAS_API_KEY in Edge secrets for live API call)',
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Make POST request to MeetingBaaS API (https://api.meetingbaas.com/bots)
    const baasResponse = await fetch('https://api.meetingbaas.com/bots', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-meeting-baas-api-key': MEETINGBAAS_API_KEY,
      },
      body: JSON.stringify({
        meeting_url: targetUrl,
        bot_name: 'Revora Assistant',
        recording_mode: 'speaker_view',
      }),
    });

    const baasData = await baasResponse.json();

    if (!baasResponse.ok) {
      console.error('MeetingBaaS API error:', baasData);
      return new Response(
        JSON.stringify({
          error: 'Failed to deploy bot via MeetingBaaS API',
          details: baasData,
        }),
        {
          status: baasResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        bot_id: baasData.bot_id || baasData.id || baasData.bot_name,
        bot_name: 'Revora Assistant',
        recording_mode: 'speaker_view',
        data: baasData,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Unexpected error in deploy-bot function:', err);
    return new Response(
      JSON.stringify({ error: err.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
