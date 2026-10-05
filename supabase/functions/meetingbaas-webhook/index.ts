import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { handleMeetingBaasWebhook } from '../_shared/meeting-pipeline.ts';

// Keep these exports for the existing transcript/lifecycle regression tests.
export { assembleTranscript, mapStatusChangeToStatus } from '../_shared/meeting-pipeline.ts';

serve(handleMeetingBaasWebhook);
