import React from 'react';
import { CheckSquare, User, CalendarClock, Loader2, CheckCircle2 } from 'lucide-react';

/**
 * Renders one action item as a readable card. Action items arrive from the
 * webhook as objects ({ task, assignee, due_day, due_date, status }), so this is
 * the single place that turns them into text — nothing is ever JSON.stringify'd
 * into the UI.
 */

const STATUS_STYLES = {
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  in_progress: { label: 'In Progress', className: 'bg-sky-100 text-[#0084FF] border-sky-200', Icon: Loader2 },
  pending: { label: 'Pending', className: 'bg-amber-100 text-amber-700 border-amber-200', Icon: CheckSquare },
};

/** "Wednesday, 2 Sep 2026" / "Wednesday" / "2 Sep 2026" / null */
export function formatDue(item) {
  if (!item || typeof item !== 'object') return null;
  const day = typeof item.due_day === 'string' && item.due_day.trim() ? item.due_day.trim() : null;
  const iso = typeof item.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date) ? item.due_date : null;

  if (!day && !iso) return null;
  if (!iso) return day;

  const pretty = new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return day ? `${day}, ${pretty}` : pretty;
}

/** Normalise whatever shape the item arrives in into displayable fields. */
export function readActionItem(item) {
  if (typeof item === 'string') return { task: item, assignee: null, due: null, status: 'pending' };
  if (!item || typeof item !== 'object') return null;
  const task = String(item.task ?? item.title ?? '').trim();
  if (!task) return null;
  return {
    task,
    assignee: typeof item.assignee === 'string' && item.assignee.trim() ? item.assignee.trim() : null,
    due: formatDue(item),
    status: STATUS_STYLES[item.status] ? item.status : 'pending',
  };
}

const ActionItemCard = ({ item }) => {
  const parsed = readActionItem(item);
  if (!parsed) return null;

  const { label, className, Icon } = STATUS_STYLES[parsed.status];

  return (
    <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-100 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold text-purple-900 leading-relaxed">{parsed.task}</p>
        <span
          className={`shrink-0 px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${className}`}
        >
          <Icon className="w-3 h-3" />
          {label}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-purple-700/90">
        <span className="flex items-center gap-1.5">
          <User className="w-3 h-3 text-purple-500" />
          <span className="font-medium text-purple-800/70">Assigned to</span>
          <span className="font-bold">{parsed.assignee || 'Unassigned'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarClock className="w-3 h-3 text-purple-500" />
          <span className="font-medium text-purple-800/70">Due</span>
          <span className="font-bold">{parsed.due || 'No deadline set'}</span>
        </span>
      </div>
    </div>
  );
};

export default ActionItemCard;
