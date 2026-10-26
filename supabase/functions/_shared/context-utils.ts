export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
export const normalizeTask = (text: unknown): string => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const fingerprintTask = (task: unknown, assignee: unknown): Promise<string> =>
  sha256(`${normalizeTask(task)}|${normalizeTask(assignee)}`);

// Only codes/generic errors leave the new context boundary, never response bodies,
// signed artifact URLs, prompts, or credentials from a transport exception.
export class ContextError extends Error {
  status: number;
  constructor(message: string, status = 500) { super(message); this.status = status; }
}
export function safeError(error: unknown): string {
  return error instanceof ContextError ? error.message : 'Context operation failed; please retry.';
}
export function missingSchema(error: { code?: string; message?: string } | null): boolean {
  return !!error && (['42703', '42P01', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ||
    /column .* does not exist/i.test(error.message ?? ''));
}
export function requireDb(error: { code?: string } | null, operation: string): void {
  if (error) throw new ContextError(`${operation} failed (${error.code || 'database_error'}).`);
}
export const stringList = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [];
