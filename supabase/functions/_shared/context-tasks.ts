import { fingerprintTask, missingSchema, normalizeTask, UUID } from './context-utils.ts';

export interface CarryoverTask { id: string; task: string; assignee: string | null; due_date: string | null; status: string }
export interface TaskUpdate { task_id: string; status: string; evidence: string }

export async function loadCarryoverTasks(admin: any, meetingId: string | null): Promise<CarryoverTask[]> {
  if (Deno.env.get('ENABLE_TASK_CARRYOVER') !== 'true' || !meetingId) return [];
  try {
    const { data: target, error } = await admin.from('meetings').select('project_id,user_id').eq('id', meetingId).maybeSingle();
    if (error || !target?.project_id) return [];
    let query = admin.from('action_items')
      .select('id,task,assignee,due_date,status,meetings!inner(project_id,user_id,status)')
      .eq('meetings.project_id', target.project_id).in('meetings.status', ['summarized', 'completed'])
      .neq('meeting_id', meetingId).in('status', ['pending', 'in_progress']).eq('status_source', 'ai')
      .order('due_date', { ascending: true, nullsFirst: false }).limit(30);
    query = target.user_id ? query.eq('meetings.user_id', target.user_id) : query.is('meetings.user_id', null);
    const { data, error: taskError } = await query;
    if (taskError) { console.warn('[Context Tasks] Carryover lookup unavailable.'); return []; }
    return (data || []).map(({ id, task, assignee, due_date, status }: CarryoverTask) =>
      ({ id, task: task.slice(0, 500), assignee, due_date, status }));
  } catch { console.warn('[Context Tasks] Carryover lookup failed safely.'); return []; }
}

export function validateTaskUpdates(value: unknown, tasks: CarryoverTask[], transcript: string): TaskUpdate[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(tasks.map((task) => task.id));
  const seen = new Set<string>();
  const source = normalizeTask(transcript);
  return value.flatMap((item) => {
    if (!item || !UUID.test(item.task_id) || !allowed.has(item.task_id) || seen.has(item.task_id) ||
      !['pending', 'in_progress', 'completed'].includes(item.status) || typeof item.evidence !== 'string') return [];
    const evidence = normalizeTask(item.evidence);
    // Evidence must be a substantive verbatim excerpt, not the model's rationale.
    if (evidence.length < 12 || evidence.length > 1200 || !source.includes(evidence)) return [];
    seen.add(item.task_id);
    return [{ task_id: item.task_id, status: item.status, evidence: item.evidence }];
  }).slice(0, 30);
}

async function resolveAssignee(admin: any, assignee: string | null): Promise<string | null> {
  if (!assignee) return null;
  const pattern = assignee.trim().replace(/[\\%_]/g, '\\$&');
  const [names, emails] = await Promise.all(['full_name', 'email'].map((column) =>
    admin.from('profiles').select('id,full_name,email').ilike(column, pattern).limit(2)));
  if (names.error || emails.error) return null;
  const key = assignee.trim().toLowerCase();
  const matches = new Set([...names.data, ...emails.data].filter((p) =>
    p.full_name?.toLowerCase() === key || p.email?.toLowerCase() === key).map((p) => p.id));
  return matches.size === 1 ? [...matches][0] as string : null;
}

// Returns false ONLY when new task columns are genuinely absent, allowing the
// unchanged legacy persistence path. Other errors preserve existing task rows.
export async function persistContextTasks(admin: any, meetingId: string, items: any[], updates: TaskUpdate[] = []): Promise<boolean> {
  try {
    const assignees = new Map<string, string | null>();
    for (const item of items) {
      if (item.assignee && !assignees.has(item.assignee)) assignees.set(item.assignee, await resolveAssignee(admin, item.assignee));
    }
    const rows = await Promise.all(items.map(async (item) => ({ ...item,
      fingerprint: await fingerprintTask(item.task, item.assignee),
      normalized_task: normalizeTask(item.task), normalized_assignee: normalizeTask(item.assignee),
      assignee_user_id: assignees.get(item.assignee) || null,
    })));
    const { error } = await admin.rpc('context_persist_action_items', {
      p_meeting_id: meetingId, p_items: rows, p_updates: updates,
    });
    if (!error) return true;
    if (missingSchema(error)) {
      const probe = await admin.from('action_items').select('status_source').limit(1);
      if (missingSchema(probe.error)) return false;
    }
    console.error(`[Context Tasks] Persistence failed safely (${error.code || 'database_error'}); existing rows retained.`);
  } catch { console.error('[Context Tasks] Persistence failed safely; existing rows retained.'); }
  return true;
}
