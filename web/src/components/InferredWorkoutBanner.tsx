import { Button, GlassCard } from '@yggdrasil-lab/ui'
import type { Routine, SessionPayload } from '../types'
import { formatFriendlyDate } from '../utils/circadian'
import { getSessionLabel } from '../utils/session'
import { getSessionDurationMinutes } from '../utils/sessionMetrics'
import { EffortBadge } from './EffortBadge'
import { HRZoneBar, type HRZonesData } from './HRZoneBar'

interface InferredWorkoutBannerProps {
  inferredSessions: SessionPayload[]
  routines: Routine[]
  circadianDate: string
  onConfirmSession: (id: string) => Promise<void> | void
  onDeleteSession: (id: string) => Promise<void> | void
  onEditSession?: (session: SessionPayload) => void
}

/**
 * Renders review cards for wearable auto-detected workouts awaiting user confirmation or dismissal.
 */
export function InferredWorkoutBanner({
  inferredSessions,
  routines,
  circadianDate,
  onConfirmSession,
  onDeleteSession,
  onEditSession,
}: InferredWorkoutBannerProps) {
  if (inferredSessions.length === 0) return null

  return (
    <div className="flex flex-col gap-3 mb-4">
      {inferredSessions.map((infSession) => {
        const routineName = getSessionLabel(infSession, routines)
        const sessionDate = infSession.started_at
          ? infSession.started_at.split('T')[0]
          : circadianDate
        const durationMins = getSessionDurationMinutes(infSession)
        const effort = (infSession.extra?.effort_rating as string) || ''
        const rpe = infSession.extra?.rpe as number | undefined
        const trimp = infSession.extra?.trimp as number | undefined
        const hrZones = infSession.extra?.hr_zones as HRZonesData | undefined
        const peakHr = infSession.extra?.peak_hr as number | undefined
        const hrRecovery = infSession.extra?.hr_recovery_60s as number | undefined
        const stepCount = infSession.extra?.step_count as number | undefined

        return (
          <GlassCard
            key={infSession.id}
            className="animate-slide-up border-amber-500/40 bg-amber-500/10 p-4"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base">⚡</span>
                <span className="font-bold text-sm text-amber-300">
                  Auto-Detected Workout ({formatFriendlyDate(sessionDate)})
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Needs Review
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <EffortBadge effort={effort} />
                {rpe !== undefined && rpe !== null && (
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/25 font-semibold">
                    RPE {rpe}
                  </span>
                )}
                {trimp !== undefined && trimp !== null && trimp > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/25 font-semibold">
                    TRIMP {Math.round(trimp)}
                  </span>
                )}
              </div>
            </div>

            <div className="mb-2">
              <div className="text-base font-bold text-slate-100">{routineName}</div>
              <div className="text-xs text-slate-300 mt-1 flex gap-3 flex-wrap items-center">
                {durationMins ? <span>⏱️ ~{durationMins} min</span> : null}
                {infSession.extra?.active_energy_kcal ? (
                  <span>🔥 {String(infSession.extra.active_energy_kcal)} kcal</span>
                ) : null}
                {stepCount ? <span>👟 {stepCount.toLocaleString()} steps</span> : null}
                {infSession.extra?.avg_hr ? (
                  <span>
                    ❤️ {String(infSession.extra.avg_hr)} bpm
                    {peakHr ? <span className="text-slate-400"> ({peakHr} max)</span> : null}
                  </span>
                ) : null}
                {hrRecovery ? (
                  <span className="text-emerald-400 font-medium">⏱️ Drop -{hrRecovery} bpm</span>
                ) : null}
              </div>
              {hrZones && (
                <div className="mt-2.5 mb-1">
                  <HRZoneBar zones={hrZones} />
                </div>
              )}
            </div>

            <p className="text-xs text-amber-200/90 mb-3">
              Auto-attached from plan and wearable biometrics. Did you complete this workout?
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="blue" size="xs" onClick={() => onConfirmSession(infSession.id)}>
                ✓ Confirm / Keep
              </Button>
              {onEditSession && (
                <Button variant="secondary" size="xs" onClick={() => onEditSession(infSession)}>
                  Change
                </Button>
              )}
              <Button variant="danger" size="xs" onClick={() => onDeleteSession(infSession.id)}>
                ✕ Dismiss Workout
              </Button>
            </div>
          </GlassCard>
        )
      })}
    </div>
  )
}
