import {
  AlertBanner,
  Button,
  ChipSelector,
  FormField,
  GlassCard,
  LoadingState,
  SegmentedControl,
  StatusBadge,
  TextInput,
  type SegmentedControlOption,
} from '@yggdrasil-lab/ui'
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
      <TextInput
        type="text"
        variant="brand"
        aria-label={`Segment ${index + 1} Class Name`}
        value={segment.routineName}
        onChange={(e) => onUpdate({ ...segment, routineName: e.target.value })}
        placeholder="Class name (e.g. Group Core)"
      />
      <ChipSelector
        options={CLASS_PRESETS}
        selected={CLASS_PRESETS.find((p) => p.toLowerCase() === segment.routineName.toLowerCase())}
        onChange={(name) => onUpdate({ ...segment, routineName: name })}
        variant="brand"
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
        variant="brand"
      />
      <TextInput
        type="text"
        variant="brand"
        aria-label={`Segment ${index + 1} Activity Name`}
        value={segment.routineName}
        onChange={(e) => onUpdate({ ...segment, routineName: e.target.value })}
        placeholder="Activity name..."
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
  const routineOptions = routines.map((routine) => {
    const isToday = Boolean(recommendedName) && routine.name.toLowerCase() === recommendedName
    return {
      value: routine.id,
      label: isToday ? `★ ${routine.name}` : routine.name,
    }
  })

  return (
    <ChipSelector
      options={routineOptions}
      selected={segment.routineId ?? undefined}
      onChange={(routineId) => {
        const selectedRoutine = routines.find((r) => r.id === routineId)
        if (selectedRoutine) {
          onUpdate({
            ...segment,
            routineId: selectedRoutine.id,
            routineName: selectedRoutine.name,
          })
        }
      }}
      variant="brand"
      className="[&_button]:min-h-[45px]"
    />
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
      <FormField label="Start" htmlFor={`seg-${index + 1}-start`}>
        <TextInput
          id={`seg-${index + 1}-start`}
          type="time"
          variant="brand"
          aria-label={`Segment ${index + 1} Start`}
          value={startHHMM}
          onChange={(e) => {
            const iso = resolveBoundaryIsoWithinWindow(parentStartIso, parentEndIso, e.target.value)
            if (iso) onUpdate({ ...segment, startedAt: iso })
          }}
        />
      </FormField>
      <FormField label="End" htmlFor={`seg-${index + 1}-end`}>
        <TextInput
          id={`seg-${index + 1}-end`}
          type="time"
          variant="brand"
          aria-label={`Segment ${index + 1} End`}
          value={endHHMM}
          onChange={(e) => {
            const iso = resolveBoundaryIsoWithinWindow(parentStartIso, parentEndIso, e.target.value)
            if (iso) onUpdate({ ...segment, endedAt: iso })
          }}
        />
      </FormField>
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
  if (metricsLoading) {
    return (
      <LoadingState
        label="Calculating Eir telemetry..."
        variant="brand"
        className="rounded-xl bg-card/60 border border-border/60 py-2"
      />
    )
  }
  if (metricsError) {
    return <AlertBanner variant="warning">{metricsError}</AlertBanner>
  }
  return (
    <div className="rounded-xl bg-card/60 border border-border/60 px-3 py-2 text-[11px] text-slate-300 flex items-center gap-3 flex-wrap">
      {metrics ? (
        <>
          {typeof metrics.active_energy_kcal === 'number' && (
            <span>🔥 {metrics.active_energy_kcal} kcal</span>
          )}
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

function SegmentCardHeader({
  index,
  startedAt,
  endedAt,
  canRemove,
  onRemove,
}: {
  index: number
  startedAt: string
  endedAt: string
  canRemove: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-slate-100">Segment {index + 1}</span>
        <StatusBadge
          label={computeDurationBadge(startedAt, endedAt)}
          variant="info"
          size="xs"
          showDot={false}
          className="rounded-md font-semibold"
        />
      </div>
      {canRemove && (
        <Button variant="ghost" size="xs" onClick={onRemove}>
          Remove
        </Button>
      )}
    </div>
  )
}

function SegmentModeFields({
  index,
  segment,
  routines,
  recommendedName,
  onUpdate,
}: {
  index: number
  segment: SplitSegmentDraft
  routines: Routine[]
  recommendedName: string
  onUpdate: (next: SplitSegmentDraft) => void
}) {
  if (segment.mode === 'class') {
    return <ClassModeFields index={index} segment={segment} onUpdate={onUpdate} />
  }
  if (segment.mode === 'cardio') {
    return <CardioModeFields index={index} segment={segment} onUpdate={onUpdate} />
  }
  return (
    <RoutineModeFields
      segment={segment}
      routines={routines}
      recommendedName={recommendedName}
      onUpdate={onUpdate}
    />
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
    <GlassCard
      tone="solid"
      padding="sm"
      className="bg-background/60 space-y-3"
      data-testid={`split-segment-${index + 1}`}
    >
      <SegmentCardHeader
        index={index}
        startedAt={segment.startedAt}
        endedAt={segment.endedAt}
        canRemove={canRemove}
        onRemove={onRemove}
      />
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
        variant="brand"
        size="xs"
        fullWidth
        idPrefix={`seg-${index + 1}-mode`}
      />
      <SegmentModeFields
        index={index}
        segment={segment}
        routines={routines}
        recommendedName={recommendedName}
        onUpdate={onUpdate}
      />
      <SegmentMetricsPreview
        metrics={metrics}
        metricsLoading={metricsLoading}
        metricsError={metricsError}
      />
    </GlassCard>
  )
}
