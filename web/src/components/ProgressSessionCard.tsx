import { AlertBanner, Button, GlassCard, StatusBadge } from '@yggdrasil-lab/ui'
import type { Exercise, Routine, SessionPayload } from '../types'
import { formatFriendlyDate, formatSessionTimeRange } from '../utils/circadian'
import { computeSessionVolumeAndSets, getSessionLabel } from '../utils/session'
import { getExerciseDisplayName, getSessionDurationMinutes } from '../utils/sessionMetrics'
import { SessionMetricBadges } from './EffortBadge'
import { HRZoneBar, type HRZonesData } from './HRZoneBar'

interface ProgressSessionCardProps {
  session: SessionPayload
  exercises: Exercise[]
  routines: Routine[]
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession: (session: SessionPayload) => void
  onSplitSession?: (session: SessionPayload) => void
  onLogSets?: (session: SessionPayload) => void
}

function SessionCardHeader({
  session,
  routines,
  isInferred,
}: {
  session: SessionPayload
  routines: Routine[]
  isInferred: boolean
}) {
  const routineName = getSessionLabel(session, routines)
  const dateStr = session.started_at.split('T')[0]
  const timeRange = formatSessionTimeRange(session.started_at, session.ended_at)
  const effort = typeof session.extra?.effort_rating === 'string' ? session.extra.effort_rating : ''
  const rpe = typeof session.extra?.rpe === 'number' ? session.extra.rpe : null
  const trimp = typeof session.extra?.trimp === 'number' ? session.extra.trimp : null
  const inferredPill = isInferred ? (
    <StatusBadge
      label="⚡ Inferred from Plan"
      variant="warning"
      size="xs"
      showDot={false}
      className="rounded-md font-semibold"
    />
  ) : null

  return (
    <div className="flex justify-between items-start mb-1.5 gap-2">
      <div className="min-w-0">
        <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
          <span>{formatFriendlyDate(dateStr)}</span>
          {timeRange && (
            <span className="text-slate-300 font-medium whitespace-nowrap" data-testid="session-time-range">
              {timeRange}
            </span>
          )}
        </div>
        <div className="font-bold text-base text-slate-100">{routineName}</div>
      </div>
      <SessionMetricBadges effort={effort} rpe={rpe} trimp={trimp} prefix={inferredPill} />
    </div>
  )
}

function SessionCardTelemetry({
  session,
  exercises,
}: {
  session: SessionPayload
  exercises: Exercise[]
}) {
  const { volume, sets } = computeSessionVolumeAndSets(session, exercises)
  const durationMins = getSessionDurationMinutes(session)
  const activeEnergy =
    typeof session.extra?.active_energy_kcal === 'number' ? session.extra.active_energy_kcal : null
  const stepCount = typeof session.extra?.step_count === 'number' ? session.extra.step_count : null
  const avgHr = typeof session.extra?.avg_hr === 'number' ? session.extra.avg_hr : null
  const peakHr = typeof session.extra?.peak_hr === 'number' ? session.extra.peak_hr : null
  const hrRecovery =
    typeof session.extra?.hr_recovery_60s === 'number' ? session.extra.hr_recovery_60s : null
  const hrZones = session.extra?.hr_zones as HRZonesData | undefined

  return (
    <>
      <div className="text-xs text-slate-300 mb-2 flex gap-3 flex-wrap">
        {durationMins !== null && <span>⏱️ {durationMins} min</span>}
        {volume > 0 && (
          <>
            <span>📦 {volume.toLocaleString()} kg volume</span>
            <span>✓ {sets} sets</span>
          </>
        )}
        {activeEnergy !== null && activeEnergy > 0 && <span>🔥 {activeEnergy} kcal</span>}
        {stepCount !== null && stepCount > 0 && <span>👟 {stepCount.toLocaleString()} steps</span>}
      </div>

      {(avgHr !== null || hrRecovery !== null) && (
        <div className="text-xs text-slate-300 mb-2 flex items-center gap-3 flex-wrap">
          {avgHr !== null && avgHr > 0 && (
            <span className="inline-flex items-center gap-1">
              ❤️ <span className="font-medium text-slate-200">{avgHr} bpm avg</span>
              {peakHr !== null && peakHr > 0 ? <span className="text-slate-400">({peakHr} max)</span> : null}
            </span>
          )}
          {hrRecovery !== null && hrRecovery > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
              ⏱️ <span>Drop -{hrRecovery} bpm</span>
            </span>
          )}
        </div>
      )}

      {Boolean(hrZones) && hrZones && (
        <div className="mt-3 mb-2">
          <HRZoneBar zones={hrZones} />
        </div>
      )}
    </>
  )
}

function SessionCardActions({
  session: s,
  isInferred,
  onDeleteSession,
  onConfirmSession,
  onEditSession,
  onSplitSession,
  onLogSets,
}: {
  session: SessionPayload
  isInferred: boolean
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession: (session: SessionPayload) => void
  onSplitSession?: (session: SessionPayload) => void
  onLogSets?: (session: SessionPayload) => void
}) {
  if (!isInferred) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        {Boolean(s.routine_id) && onLogSets && (
          <Button variant={s.items.length === 0 ? 'brand' : 'secondary'} size="xs" onClick={() => onLogSets(s)}>
            {s.items.length === 0 ? 'Log Sets' : 'Edit Sets'}
          </Button>
        )}
        {onSplitSession && (
          <Button variant="outline" size="xs" onClick={() => onSplitSession(s)}>
            Split
          </Button>
        )}
        <Button variant="secondary" size="xs" onClick={() => onEditSession(s)} title="Edit Workout Details">
          Change
        </Button>
      </div>
    )
  }
  return (
    <AlertBanner variant="warning" className="mt-2 mb-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex-1 min-w-[180px]">
          Auto-detected from plan and biometrics. Keep or dismiss?
        </span>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <Button variant="brand" size="xs" onClick={() => onConfirmSession(s.id)}>
            ✓ Confirm
          </Button>
          {onSplitSession && (
            <Button variant="outline" size="xs" onClick={() => onSplitSession(s)}>
              Split
            </Button>
          )}
          <Button variant="secondary" size="xs" onClick={() => onEditSession(s)}>
            Change
          </Button>
          <Button variant="danger" size="xs" onClick={() => onDeleteSession(s.id)}>
            ✕ Dismiss
          </Button>
        </div>
      </div>
    </AlertBanner>
  )
}

/**
 * Renders one recent workout card in ProgressView with telemetry, split, edit, and set-logging actions.
 */
export function ProgressSessionCard({
  session: s,
  exercises,
  routines,
  onDeleteSession,
  onConfirmSession,
  onEditSession,
  onSplitSession,
  onLogSets,
}: ProgressSessionCardProps) {
  const tags = Array.isArray(s.extra?.effort_tags) ? (s.extra.effort_tags as string[]) : []
  const isInferred = Boolean(s.extra?.inferred)

  return (
    <GlassCard className="p-4">
      <SessionCardHeader session={s} routines={routines} isInferred={isInferred} />
      <SessionCardActions
        session={s}
        isInferred={isInferred}
        onDeleteSession={onDeleteSession}
        onConfirmSession={onConfirmSession}
        onEditSession={onEditSession}
        onSplitSession={onSplitSession}
        onLogSets={onLogSets}
      />
      <SessionCardTelemetry session={s} exercises={exercises} />

      {tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mb-2">
          {tags.map((t, idx) => (
            <StatusBadge
              key={idx}
              label={t}
              variant="purple"
              size="xs"
              showDot={false}
              className="rounded-md"
            />
          ))}
        </div>
      )}

      <div className="text-xs text-slate-400 flex flex-wrap gap-1.5">
        {s.items.map((it) => (
          <span key={it.id} className="bg-background/60 px-2 py-0.5 rounded-md border border-border/50">
            {getExerciseDisplayName(it.exercise_id, exercises)} ({it.sets.filter((x) => x.status === 'done').length} sets)
          </span>
        ))}
      </div>

      {Boolean(s.notes) && <div className="text-xs text-slate-300 mt-2">&ldquo;{s.notes}&rdquo;</div>}
    </GlassCard>
  )
}
