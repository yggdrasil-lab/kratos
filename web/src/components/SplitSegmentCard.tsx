import { Button, ChipSelector, SegmentedControl, type SegmentedControlOption } from '@yggdrasil-lab/ui'
import type { ActivityType, Routine, WorkoutMetrics, WorkoutRecommendation } from '../types'
import {
  formatIsoToLocalHHMM,
  getDefaultLabelForActivity,
  resolveBoundaryIsoWithinWindow,
  type SegmentMode,
  type SplitSegmentDraft,
} from '../utils/splitSession'

interface SplitSegmentCardProps {
  index: number
  segment: SplitSegmentDraft
  parentStartIso: string
  parentEndIso: string
  routines: Routine[]
  workoutRecommendation: WorkoutRecommendation | null
  metrics: WorkoutMetrics | undefined
  metricsLoading: boolean
  metricsError: string | undefined
  canRemove: boolean
  onUpdate: (next: SplitSegmentDraft) => void
  onRemove: () => void
}

const MODE_OPTIONS: SegmentedControlOption<SegmentMode>[] = [
  { id: 'class', label: 'Gym Class' },
  { id: 'cardio', label: 'Cardio / Sport' },
  { id: 'routine', label: 'Routine' },
]

const CLASS_PRESETS = ['Group Core', 'BodyPump', 'HIIT Class', 'Spin / Cycle']

const CARDIO_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'walk', label: 'Walk / Cardio' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'swim', label: 'Swimming' },
  { value: 'gym', label: 'Open Gym' },
]

function computeDurationBadge(startIso: string, endIso: string): string {
  const diffMins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000)
  return Number.isFinite(diffMins) && diffMins > 0 ? `${diffMins}m` : 'Invalid'
}

function buildUpdatedModeSegment(
  segment: SplitSegmentDraft,
  nextMode: SegmentMode,
  routines: Routine[],
  recommendedName: string
): SplitSegmentDraft {
  if (nextMode === 'class') {
    return {
      ...segment,
      mode: 'class',
      activityType: 'class',
      routineId: null,
      routineName: segment.mode === 'class' ? segment.routineName : 'Group Core',
    }
  }
  if (nextMode === 'cardio') {
    const nextActivity: ActivityType =
      segment.activityType === 'class' ? 'walk' : segment.activityType
    return {
      ...segment,
      mode: 'cardio',
      activityType: nextActivity,
      routineId: null,
      routineName: getDefaultLabelForActivity(nextActivity),
    }
  }
  const defaultRoutine =
    routines.find((r) => r.name.toLowerCase() === recommendedName) ||
    routines.find((r) => r.items.length > 0) ||
    routines[0] ||
    null
  return {
    ...segment,
    mode: 'routine',
    activityType: 'gym',
    routineId: defaultRoutine?.id || null,
    routineName: defaultRoutine?.name || segment.routineName || 'Strength Routine',
  }
}

function ClassModeFields({
  index,
  segment,
  onUpdate,
}: {
  index: number
  segment: SplitSegmentDraft
  onUpdate: (next: SplitSegmentDraft) => void
}) {
  return (
    <div className="space-y-2">
      <input
        type="text"
        aria-label={`Segment ${index + 1} Class Name`}
        value={segment.routineName}
        onChange={(e) => onUpdate({ ...segment, routineName: e.target.value })}
        placeholder="Class name (e.g. Group Core)"
        className="w-full px-3 py-2 rounded-xl bg-background border border-border text-base sm:text-xs text-slate-100"
      />
      <ChipSelector
        options={CLASS_PRESETS}
        selected={CLASS_PRESETS.find((p) => p.toLowerCase() === segment.routineName.toLowerCase())}
        onChange={(name) => onUpdate({ ...segment, routineName: name })}
        variant="blue"
      />
    </div>
  )
}

function CardioModeFields({
  index,
  segment,
  onUpdate,
}: {
  index: number
  segment: SplitSegmentDraft
  onUpdate: (next: SplitSegmentDraft) => void
}) {
  return (
    <div className="space-y-2">
      <ChipSelector
        options={CARDIO_OPTIONS}
        selected={segment.activityType}
        onChange={(val) => {
          const nextActivity = val as ActivityType
          onUpdate({
            ...segment,
            activityType: nextActivity,
            routineName: getDefaultLabelForActivity(nextActivity),
          })
        }}
        variant="blue"
      />
      <input
        type="text"
        aria-label={`Segment ${index + 1} Activity Name`}
        value={segment.routineName}
        onChange={(e) => onUpdate({ ...segment, routineName: e.target.value })}
        placeholder="Activity name..."
        className="w-full px-3 py-2 rounded-xl bg-background border border-border text-base sm:text-xs text-slate-100"
      />
    </div>
  )
}

function RoutineModeFields({
  segment,
  routines,
  recommendedName,
  onUpdate,
}: {
  segment: SplitSegmentDraft
  routines: Routine[]
  recommendedName: string
  onUpdate: (next: SplitSegmentDraft) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {routines.map((routine) => {
        const isSelected = segment.routineId === routine.id
        const isToday = Boolean(recommendedName) && routine.name.toLowerCase() === recommendedName
        return (
          <button
            key={routine.id}
            type="button"
            onClick={() => onUpdate({ ...segment, routineId: routine.id, routineName: routine.name })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              isSelected
                ? 'bg-blue-500/25 text-blue-200 border-blue-500 font-semibold'
                : 'bg-background text-slate-300 border-border hover:text-white'
            }`}
          >
            {isToday ? `★ ${routine.name}` : routine.name}
          </button>
        )
      })}
    </div>
  )
}

function SegmentTimeInputs({
  index,
  segment,
  parentStartIso,
  parentEndIso,
  onUpdate,
}: {
  index: number
  segment: SplitSegmentDraft
  parentStartIso: string
  parentEndIso: string
  onUpdate: (next: SplitSegmentDraft) => void
}) {
  const startHHMM = formatIsoToLocalHHMM(segment.startedAt)
  const endHHMM = formatIsoToLocalHHMM(segment.endedAt)
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="block text-[11px] font-semibold text-slate-400 mb-1">Start</label>
        <input
          type="time"
          aria-label={`Segment ${index + 1} Start`}
          value={startHHMM}
          onChange={(e) => {
            const iso = resolveBoundaryIsoWithinWindow(parentStartIso, parentEndIso, e.target.value)
            if (iso) onUpdate({ ...segment, startedAt: iso })
          }}
          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl bg-background border border-border text-base sm:text-xs text-slate-100"
        />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-slate-400 mb-1">End</label>
        <input
          type="time"
          aria-label={`Segment ${index + 1} End`}
          value={endHHMM}
          onChange={(e) => {
            const iso = resolveBoundaryIsoWithinWindow(parentStartIso, parentEndIso, e.target.value)
            if (iso) onUpdate({ ...segment, endedAt: iso })
          }}
          className="w-full min-h-[44px] px-2.5 py-2 rounded-xl bg-background border border-border text-base sm:text-xs text-slate-100"
        />
      </div>
    </div>
  )
}

function SegmentMetricsPreview({
  metrics,
  metricsLoading,
  metricsError,
}: {
  metrics: WorkoutMetrics | undefined
  metricsLoading: boolean
  metricsError: string | undefined
}) {
  return (
    <div className="rounded-xl bg-card/60 border border-border/60 px-2.5 py-2 text-[11px] text-slate-300 flex items-center gap-2.5 flex-wrap">
      {metricsLoading ? (
        <span className="text-slate-400 animate-pulse">Calculating Eir telemetry...</span>
      ) : metricsError ? (
        <span className="text-amber-300">{metricsError}</span>
      ) : metrics ? (
        <>
          <span>🔥 {metrics.active_energy_kcal} kcal</span>
          {typeof metrics.avg_hr_bpm === 'number' && (
            <span>
              ❤️ {metrics.avg_hr_bpm} bpm
              {typeof metrics.peak_hr_bpm === 'number' ? ` (${metrics.peak_hr_bpm} max)` : ''}
            </span>
          )}
          {typeof metrics.rpe === 'number' && <span>RPE {metrics.rpe}</span>}
          {typeof metrics.trimp === 'number' && metrics.trimp > 0 && (
            <span>TRIMP {Math.round(metrics.trimp)}</span>
          )}
        </>
      ) : (
        <span className="text-slate-400">Adjust time range to preview Eir biometrics</span>
      )}
    </div>
  )
}

/**
 * Renders one gap-aware segment row inside SplitSessionModal.
 */
export function SplitSegmentCard({
  index,
  segment,
  parentStartIso,
  parentEndIso,
  routines,
  workoutRecommendation,
  metrics,
  metricsLoading,
  metricsError,
  canRemove,
  onUpdate,
  onRemove,
}: SplitSegmentCardProps) {
  const recommendedName = workoutRecommendation?.routine_name?.toLowerCase() || ''

  return (
    <div
      className="rounded-2xl bg-background/60 border border-border p-3 space-y-3"
      data-testid={`split-segment-${index + 1}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-100">Segment {index + 1}</span>
          <span className="text-[11px] px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-300 font-semibold">
            {computeDurationBadge(segment.startedAt, segment.endedAt)}
          </span>
        </div>
        {canRemove && (
          <Button variant="ghost" size="xs" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>

      <SegmentTimeInputs
        index={index}
        segment={segment}
        parentStartIso={parentStartIso}
        parentEndIso={parentEndIso}
        onUpdate={onUpdate}
      />

      <SegmentedControl
        options={MODE_OPTIONS}
        value={segment.mode}
        onChange={(nextMode) =>
          onUpdate(buildUpdatedModeSegment(segment, nextMode, routines, recommendedName))
        }
        variant="blue"
        size="xs"
        fullWidth
        idPrefix={`seg-${index + 1}-mode`}
      />

      {segment.mode === 'class' ? (
        <ClassModeFields index={index} segment={segment} onUpdate={onUpdate} />
      ) : segment.mode === 'cardio' ? (
        <CardioModeFields index={index} segment={segment} onUpdate={onUpdate} />
      ) : (
        <RoutineModeFields
          segment={segment}
          routines={routines}
          recommendedName={recommendedName}
          onUpdate={onUpdate}
        />
      )}

      <SegmentMetricsPreview
        metrics={metrics}
        metricsLoading={metricsLoading}
        metricsError={metricsError}
      />
    </div>
  )
}
