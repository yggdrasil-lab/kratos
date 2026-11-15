import type { EffortRating } from '../types'

interface EffortBadgeProps {
  effort?: EffortRating | string | null
  className?: string
}

const EFFORT_BADGE_MAP: Record<EffortRating, { label: string; classes: string }> = {
  too_easy: {
    label: '🟢 Too Easy',
    classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  },
  optimal: {
    label: '🟡 Optimal',
    classes: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  },
  hard: {
    label: '🟠 Hard',
    classes: 'bg-orange-500/15 text-orange-400 border-orange-500/25',
  },
  too_hard: {
    label: '🔴 Too Hard',
    classes: 'bg-rose-500/15 text-rose-400 border-rose-500/25',
  },
}

/**
 * Renders a color-coded pill badge for a session's perceived effort rating.
 */
export function EffortBadge({ effort, className = '' }: EffortBadgeProps) {
  if (!effort || !(effort in EFFORT_BADGE_MAP)) return null
  const config = EFFORT_BADGE_MAP[effort as EffortRating]

  return (
    <span
      className={`text-[11px] px-2 py-0.5 rounded-md font-semibold border ${config.classes} ${className}`}
    >
      {config.label}
    </span>
  )
}
