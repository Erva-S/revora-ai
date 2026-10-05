// Svix signing protocol: HMAC-SHA256(id.timestamp.rawBody), base64, v1 signatures.
// https://docs.svix.com/receiving/verifying-payloads/how-manual
export async function verifyMeetingBaasRequest(req: Request, rawBody: string): Promise<boolean> {
  if (req.headers.has('svix-signature') || req.headers.has('svix-id') || req.headers.has('svix-timestamp')) {
    const secret = Deno.env.get('MEETINGBAAS_WEBHOOK_SIGNING_SECRET')?.trim();
    const id = req.headers.get('svix-id');
    const timestamp = req.headers.get('svix-timestamp') || '';
    const seconds = Number(timestamp);
    if (!secret?.startsWith('whsec_') || !id || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
    try {
      const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('raw', decode(secret.slice(6)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      const bytes = new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`);
      for (const signature of (req.headers.get('svix-signature') || '').split(' ')) {
        const [version, value] = signature.split(',');
        if (version === 'v1' && value && await crypto.subtle.verify('HMAC', key, decode(value), bytes)) return true;
      }
    } catch { /* malformed signature/secret */ }
    return false;
  }
  // Preserve the existing per-bot callback secret mechanism.
  const expected = Deno.env.get('MEETINGBAAS_WEBHOOK_SECRET')?.trim();
  if (!expected) return !Deno.env.get('MEETINGBAAS_WEBHOOK_SIGNING_SECRET');
  return (req.headers.get('x-mb-secret') || req.headers.get('x-webhook-secret') || new URL(req.url).searchParams.get('token')) === expected;
}
