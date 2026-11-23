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
  onSplitSession?: (session: SessionPayload) => void
}

function InferredSessionMetricsRow({
  session,
  durationMins,
}: {
  session: SessionPayload
  durationMins: number | null
}) {
  const activeEnergy =
    typeof session.extra?.active_energy_kcal === 'number' ? session.extra.active_energy_kcal : null
  const stepCount = typeof session.extra?.step_count === 'number' ? session.extra.step_count : null
  const avgHr = typeof session.extra?.avg_hr === 'number' ? session.extra.avg_hr : null
  const peakHr = typeof session.extra?.peak_hr === 'number' ? session.extra.peak_hr : null
  const hrRecovery =
    typeof session.extra?.hr_recovery_60s === 'number' ? session.extra.hr_recovery_60s : null

  return (
    <div className="text-xs text-slate-300 mt-1 flex gap-3 flex-wrap items-center">
      {durationMins !== null && <span>⏱️ ~{durationMins} min</span>}
      {activeEnergy !== null && activeEnergy > 0 && <span>🔥 {activeEnergy} kcal</span>}
      {stepCount !== null && stepCount > 0 && <span>👟 {stepCount.toLocaleString()} steps</span>}
      {avgHr !== null && avgHr > 0 && (
        <span>
          ❤️ {avgHr} bpm
          {peakHr !== null && peakHr > 0 ? <span className="text-slate-400"> ({peakHr} max)</span> : null}
        </span>
      )}
      {hrRecovery !== null && hrRecovery > 0 && (
        <span className="text-emerald-400 font-medium">⏱️ Drop -{hrRecovery} bpm</span>
      )}
    </div>
  )
}

function InferredCardHeader({
  sessionDate,
  effort,
  rpe,
  trimp,
}: {
  sessionDate: string
  effort: string
  rpe: number | null
  trimp: number | null
}) {
  return (
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
        {rpe !== null && (
          <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/25 font-semibold">
            RPE {rpe}
          </span>
        )}
        {trimp !== null && trimp > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/25 font-semibold">
            TRIMP {Math.round(trimp)}
          </span>
        )}
      </div>
    </div>
  )
}

function InferredSessionCard({
  infSession,
  routines,
  circadianDate,
  onConfirmSession,
  onDeleteSession,
  onEditSession,
  onSplitSession,
}: {
  infSession: SessionPayload
  routines: Routine[]
  circadianDate: string
  onConfirmSession: (id: string) => Promise<void> | void
  onDeleteSession: (id: string) => Promise<void> | void
  onEditSession?: (session: SessionPayload) => void
  onSplitSession?: (session: SessionPayload) => void
}) {
  const routineName = getSessionLabel(infSession, routines)
  const sessionDate = infSession.started_at ? infSession.started_at.split('T')[0] : circadianDate
  const durationMins = getSessionDurationMinutes(infSession)
  const effort = typeof infSession.extra?.effort_rating === 'string' ? infSession.extra.effort_rating : ''
  const rpe = typeof infSession.extra?.rpe === 'number' ? infSession.extra.rpe : null
  const trimp = typeof infSession.extra?.trimp === 'number' ? infSession.extra.trimp : null
  const hrZones = infSession.extra?.hr_zones as HRZonesData | undefined

  return (
    <GlassCard className="animate-slide-up border-amber-500/40 bg-amber-500/10 p-4">
      <InferredCardHeader sessionDate={sessionDate} effort={effort} rpe={rpe} trimp={trimp} />

      <div className="mb-2">
        <div className="text-base font-bold text-slate-100">{routineName}</div>
        <InferredSessionMetricsRow session={infSession} durationMins={durationMins} />
        {Boolean(hrZones) && hrZones && (
          <div className="mt-3 mb-1">
            <HRZoneBar zones={hrZones} />
          </div>
        )}
      </div>

      <p className="text-xs text-amber-200 mb-3">
        Auto-attached from plan and wearable biometrics. Did you complete this workout?
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="blue" size="xs" onClick={() => onConfirmSession(infSession.id)}>
          ✓ Confirm / Keep
        </Button>
        {onSplitSession && (
          <Button variant="outline" size="xs" onClick={() => onSplitSession(infSession)}>
            Split
          </Button>
        )}
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
}

/**
 * Renders review cards for wearable auto-detected workouts awaiting confirmation, split, or dismissal.
 */
export function InferredWorkoutBanner({
  inferredSessions,
  routines,
  circadianDate,
  onConfirmSession,
  onDeleteSession,
  onEditSession,
  onSplitSession,
}: InferredWorkoutBannerProps) {
  if (inferredSessions.length === 0) return null

  return (
    <div className="flex flex-col gap-3 mb-4">
      {inferredSessions.map((infSession) => (
        <InferredSessionCard
          key={infSession.id}
          infSession={infSession}
          routines={routines}
          circadianDate={circadianDate}
          onConfirmSession={onConfirmSession}
          onDeleteSession={onDeleteSession}
          onEditSession={onEditSession}
          onSplitSession={onSplitSession}
        />
      ))}
    </div>
  )
}
