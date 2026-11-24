import type { ReactNode } from 'react'
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
      className={`text-[11px] px-2 py-0.5 rounded-md font-semibold border whitespace-nowrap ${config.classes} ${className}`}
    >
      {config.label}
    </span>
  )
}

/**
 * Renders the right-aligned effort, RPE, and TRIMP badge cluster for session cards.
 */
export function SessionMetricBadges({
  effort,
  rpe,
  trimp,
  prefix,
}: {
  effort?: EffortRating | string | null
  rpe: number | null
  trimp: number | null
  prefix?: ReactNode
}) {
  const hasEffort = Boolean(effort && effort in EFFORT_BADGE_MAP)
  const hasRpe = rpe !== null
  const hasTrimp = trimp !== null && trimp > 0
  if (!prefix && !hasEffort && !hasRpe && !hasTrimp) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {prefix}
      <EffortBadge effort={effort} />
      {hasRpe && (
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/25 font-semibold whitespace-nowrap">
          RPE {rpe}
        </span>
      )}
      {hasTrimp && (
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/25 font-semibold whitespace-nowrap">
          TRIMP {Math.round(trimp)}
        </span>
      )}
    </div>
  )
}
