import type { ReactNode } from 'react'
import { StatusBadge, type StatusBadgeVariant } from '@yggdrasil-lab/ui'
import type { EffortRating } from '../types'

interface EffortBadgeProps {
  effort?: EffortRating | string | null
  className?: string
}

const EFFORT_BADGE_MAP: Record<EffortRating, { label: string; variant: StatusBadgeVariant }> = {
  too_easy: { label: '🟢 Too Easy', variant: 'success' },
  optimal: { label: '🟡 Optimal', variant: 'warning' },
  hard: { label: '🟠 Hard', variant: 'orange' },
  too_hard: { label: '🔴 Too Hard', variant: 'error' },
}

/**
 * Renders a color-coded pill badge for a session's perceived effort rating.
 */
export function EffortBadge({ effort, className = '' }: EffortBadgeProps) {
  if (!effort || !(effort in EFFORT_BADGE_MAP)) return null
  const config = EFFORT_BADGE_MAP[effort as EffortRating]

  return (
    <StatusBadge
      label={config.label}
      variant={config.variant}
      size="xs"
      showDot={false}
      className={`rounded-md font-semibold ${className}`}
    />
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
        <StatusBadge
          label={`RPE ${rpe}`}
          variant="purple"
          size="xs"
          showDot={false}
          className="rounded-md font-semibold"
        />
      )}
      {hasTrimp && (
        <StatusBadge
          label={`TRIMP ${Math.round(trimp)}`}
          variant="info"
          size="xs"
          showDot={false}
          className="rounded-md font-semibold"
        />
      )}
    </div>
  )
}
