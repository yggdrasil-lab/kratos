import { useState } from 'react'
import {
  AiSynthesizerModal,
  AlertBanner,
  Button,
  CollapsibleSection,
  EmptyState,
  GlassCard,
  LoadingState,
  SectionHeader,
  StatusBadge,
  SummaryMetricGrid,
} from '@yggdrasil-lab/ui'
import type { Exercise, Routine, SessionPayload, WorkoutRecommendation } from '../types'
import { resolveTodayRoutineState } from '../utils/readiness'
import { getSessionLabel, isPerHandExercise } from '../utils/session'
import {
  getCompletedTodaySummary,
  getExerciseGhostTarget,
  getSessionDurationMinutes,
  type TodayCompletedSummary,
} from '../utils/sessionMetrics'

interface TodayTrainingCardProps {
  circadianDate: string
  workoutRecommendation?: WorkoutRecommendation | null
  routines: Routine[]
  exercises: Exercise[]
  sessions: SessionPayload[]
  isGeneratingWorkout?: boolean
  onStartRoutine: (routine?: Routine) => void
  onSynthesizeWorkoutRecommendation?: (customContext?: string) => Promise<void>
}

const INLINE_CITATION_PILLARS = [
  {
    icon: '📊',
    label: 'Israetel (RP):',
    description: 'Sets scaled between MEV (2 sets deload on fatigue) and MAV (3+ overload sets).',
  },
  {
    icon: '🎯',
    label: 'Helms:',
    description: 'Target RIR dictated by recovery score (RIR 1-2 on primed days; RIR 3-4 on fatigue).',
  },
  {
    icon: '🛡️',
    label: 'McGill / Starrett:',
    description: 'Neutral grips and joint-sparing substitutions when friction is detected.',
  },
  {
    icon: '🏸',
    label: 'Concurrent Interference:',
    description: 'Preserves leg power adjacent to badminton match play.',
  },
]

const WORKOUT_PILLARS = [
  {
    label: 'Volume Landmarks (RP)',
    description: 'Sets scaled between MEV (2 sets deload on fatigue) and MAV (3+ overload sets).',
  },
  {
    label: 'RIR Autoregulation',
    description: 'Target RIR dictated by recovery score (RIR 1-2 on primed days; RIR 3-4 on fatigue).',
  },
  {
    label: 'Joint Sparing (McGill)',
    description: 'Neutral grips and chest-supported variations to spare impinged shoulders/spine.',
  },
  {
    label: 'Court Freshness',
    description: 'Preserves leg power and avoids eccentric damage adjacent to badminton match play.',
  },
]

function LoggedClassChips({
  classSessions,
  routines,
}: {
  classSessions: SessionPayload[]
  routines: Routine[]
}) {
  if (classSessions.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 mb-3" data-testid="logged-class-chips">
      {classSessions.map((cls) => {
        const label = getSessionLabel(cls, routines)
        const duration = getSessionDurationMinutes(cls)
        const kcal =
          typeof cls.extra?.active_energy_kcal === 'number' ? cls.extra.active_energy_kcal : null
        const durationText = duration !== null ? ` (${duration}m)` : ''
        const kcalText = kcal !== null && kcal > 0 ? ` • ${kcal} kcal` : ''
        return (
          <StatusBadge
            key={cls.id}
            label={`✓ ${label}${durationText} completed today${kcalText}`}
            variant="success"
            size="sm"
            showDot={false}
            className="font-semibold"
          />
        )
      })}
    </div>
  )
}

function RoutinePickerPanel({
  routines,
  activeRoutine,
  selectedRoutineOverride,
  recommendedRoutineName,
  onSelectRoutine,
  onReset,
}: {
  routines: Routine[]
  activeRoutine: Routine | null
  selectedRoutineOverride: Routine | null
  recommendedRoutineName?: string
  onSelectRoutine: (r: Routine) => void
  onReset: () => void
}) {
  return (
    <div className="bg-background/80 rounded-xl p-3 mb-4 flex flex-col gap-1.5 border border-border">
      <div className="text-xs font-semibold text-slate-300 mb-1">Pick another routine for today:</div>
      {selectedRoutineOverride && (
        <Button
          variant="outline"
          size="sm"
          fullWidth
          className="text-accent border-accent/40 mb-1"
          style={{ justifyContent: 'flex-start' }}
          onClick={onReset}
        >
          ↺ Reset to Scheduled ({recommendedRoutineName || 'Default'})
        </Button>
      )}
      {routines.map((r) => (
        <Button
          key={r.id}
          variant={activeRoutine?.id === r.id ? 'brand' : 'secondary'}
          size="sm"
          fullWidth
          style={{ justifyContent: 'flex-start' }}
          onClick={() => onSelectRoutine(r)}
        >
          {r.name}
        </Button>
      ))}
    </div>
  )
}

function RecommendedExercisePreview({
  workoutRecommendation,
  exercises,
}: {
  workoutRecommendation: WorkoutRecommendation
  exercises: Exercise[]
}) {
  return (
    <div className="flex flex-col gap-2 mb-4">
      {workoutRecommendation.exercises.map((recEx, idx) => {
        const matchEx = exercises.find((e) => e.name.toLowerCase() === recEx.exercise_name.toLowerCase())
        const isPerHand = isPerHandExercise(matchEx, recEx.weight_basis, recEx.exercise_name)
        return (
          <div key={idx} className="bg-background/60 rounded-xl px-3.5 py-2.5 flex flex-col gap-1 border border-border/60">
            <div className="flex justify-between items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-semibold">{idx + 1}.</span>
                <span className="text-sm font-semibold text-slate-100">{recEx.exercise_name}</span>
              </div>
              <span className="text-xs text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md font-semibold shrink-0">
                {recEx.suggested_weight_kg ? `${recEx.suggested_weight_kg}kg${isPerHand ? ' per hand' : ''} • ` : ''}
                {recEx.target_sets} sets x {recEx.target_reps}
              </span>
            </div>
            {Boolean(recEx.notes) && <div className="text-xs text-slate-300 pl-4">Cue: {recEx.notes}</div>}
          </div>
        )
      })}
    </div>
  )
}

function RoutineExercisePreview({
  activeRoutine,
  exercises,
  sessions,
}: {
  activeRoutine: Routine
  exercises: Exercise[]
  sessions: SessionPayload[]
}) {
  return (
    <div className="flex flex-col gap-2 mb-4">
      {activeRoutine.items.map((it, idx) => {
        const ex = exercises.find((e) => e.id === it.exercise_id)
        const exName = ex ? ex.name : `Exercise ${idx + 1}`
        const isPerHand = isPerHandExercise(ex, undefined, exName)
        const ghost = getExerciseGhostTarget(it.exercise_id, sessions)

        return (
          <div key={it.id} className="bg-background/60 rounded-xl px-3.5 py-2.5 flex justify-between items-center border border-border/60">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-semibold">{idx + 1}.</span>
              <span className="text-sm font-semibold text-slate-100">{exName}</span>
            </div>
            {ghost && ghost.weightKg !== null ? (
              <span className="text-xs text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md">
                Last: {ghost.weightKg}kg{isPerHand ? ' per hand' : ''} x {ghost.reps ?? 'failure'}
              </span>
            ) : (
              <span className="text-xs text-slate-400">2 sets to failure</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TodayTrainingStatusRow({
  isLiftPendingAfterClass,
  isGeneratingWorkout,
  isLlmGenerated,
}: {
  isLiftPendingAfterClass: boolean
  isGeneratingWorkout?: boolean
  isLlmGenerated?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-accent font-semibold uppercase">Today&apos;s Training</span>
      {isLiftPendingAfterClass && (
        <StatusBadge
          label="Pending"
          variant="warning"
          size="xs"
          showDot={false}
          className="rounded-md font-semibold"
        />
      )}
      {isGeneratingWorkout && (
        <StatusBadge
          label="⚡ Synthesizing AI Training..."
          variant="busy"
          size="xs"
          showDot={false}
          isPulsing
          className="rounded-md font-semibold"
        />
      )}
      {isLlmGenerated && (
        <StatusBadge
          label="⚡ AI Autoregulated"
          variant="info"
          size="xs"
          showDot={false}
          className="rounded-md font-semibold"
        />
      )}
    </div>
  )
}

function TodayTrainingHeaderActions({
  hasAiHandler,
  showRoutinePicker,
  onOpenAiModal,
  onTogglePicker,
}: {
  hasAiHandler: boolean
  showRoutinePicker: boolean
  onOpenAiModal: () => void
  onTogglePicker: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {hasAiHandler && (
        <Button
          variant="outline"
          size="xs"
          icon={<span>⚡</span>}
          onClick={onOpenAiModal}
          title="Autoregulate training with AI sports physiology"
          className="border-accent/40 text-accent"
        >
          Adapt
        </Button>
      )}
      <Button variant="secondary" size="xs" onClick={onTogglePicker}>
        {showRoutinePicker ? 'Close' : 'Swap Split'}
      </Button>
    </div>
  )
}

function TodayTrainingHeader({
  dayHeadline,
  daySubtitle,
  isLiftPendingAfterClass,
  isGeneratingWorkout,
  workoutRecommendation,
  showRoutinePicker,
  onOpenAiModal,
  onTogglePicker,
  hasAiHandler,
}: {
  dayHeadline: string
  daySubtitle: string
  isLiftPendingAfterClass: boolean
  isGeneratingWorkout?: boolean
  workoutRecommendation?: WorkoutRecommendation | null
  showRoutinePicker: boolean
  onOpenAiModal: () => void
  onTogglePicker: () => void
  hasAiHandler: boolean
}) {
  return (
    <div className="mb-3 space-y-1.5">
      <TodayTrainingStatusRow
        isLiftPendingAfterClass={isLiftPendingAfterClass}
        isGeneratingWorkout={isGeneratingWorkout}
        isLlmGenerated={workoutRecommendation?.is_llm_generated}
      />
      <SectionHeader
        title={dayHeadline}
        subtitle={daySubtitle}
        titleAs="h3"
        size="md"
        variant="brand"
        actions={
          <TodayTrainingHeaderActions
            hasAiHandler={hasAiHandler}
            showRoutinePicker={showRoutinePicker}
            onOpenAiModal={onOpenAiModal}
            onTogglePicker={onTogglePicker}
          />
        }
      />
    </div>
  )
}

function TodayTrainingActionSection({
  summary,
  completedLabel,
  hasActionableStrength,
  startLabelName,
  activeRoutine,
  onStartRoutine,
}: {
  summary: TodayCompletedSummary
  completedLabel: string
  hasActionableStrength: boolean
  startLabelName?: string
  activeRoutine: Routine | null
  onStartRoutine: (routine?: Routine) => void
}) {
  if (summary.hasCompletedPrimaryToday) {
    return (
      <div className="space-y-3" data-testid="completed-workout-card">
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
          <StatusBadge
            label="Completed ✓"
            variant="success"
            size="sm"
            showDot={false}
            className="uppercase tracking-wider mb-2 font-semibold"
          />
          <div className="text-sm font-semibold text-slate-200 mb-2">{completedLabel}</div>
          <SummaryMetricGrid
            columns={3}
            className="pt-2 border-t border-emerald-500/20"
            items={[
              { id: 'duration', label: 'Duration', value: `${summary.totalDurationMins}m` },
              { id: 'sets', label: 'Total Sets', value: summary.totalSets },
              { id: 'volume', label: 'Volume', value: `${summary.totalVolumeKg.toLocaleString()} kg` },
            ]}
          />
        </div>
        <Button variant="secondary" size="md" fullWidth onClick={() => onStartRoutine(activeRoutine || undefined)}>
          Start Another Session ({startLabelName || 'Workout'})
        </Button>
      </div>
    )
  }

  if (hasActionableStrength) {
    return (
      <Button variant="brand" size="lg" fullWidth onClick={() => onStartRoutine(activeRoutine || undefined)}>
        Start Workout ({startLabelName || 'Session'})
      </Button>
    )
  }

  return (
    <EmptyState
      variant="dashed"
      title="No routine scheduled for today."
      description="Configure routines in the Plan tab or tap Adapt to synthesize with AI."
      className="p-4"
    />
  )
}

function TodayWorkoutRecommendationAlerts({
  isGeneratingWorkout,
  workoutRecommendation,
}: {
  isGeneratingWorkout?: boolean
  workoutRecommendation?: WorkoutRecommendation | null
}) {
  return (
    <>
      {isGeneratingWorkout && !workoutRecommendation && (
        <LoadingState
          label="Synthesizing today's autoregulated training prescription and Discord thread..."
          variant="brand"
          className="bg-accent/10 border border-accent/20 rounded-xl py-4 mb-4"
        />
      )}
      {workoutRecommendation && (
        <AlertBanner
          variant={
            workoutRecommendation.recovery_status === 'fatigued'
              ? 'error'
              : workoutRecommendation.recovery_status === 'moderate'
              ? 'warning'
              : 'success'
          }
          icon={workoutRecommendation.recovery_status === 'fatigued' ? '🛡️' : '🎯'}
          title={workoutRecommendation.readiness_adaptation}
          className="mb-4"
        >
          {workoutRecommendation.rationale} ({workoutRecommendation.volume_landmark} • {workoutRecommendation.target_rir})
        </AlertBanner>
      )}
    </>
  )
}

function TodayTrainingBody({
  showRecommendedPreview,
  workoutRecommendation,
  activeRoutine,
  exercises,
  sessions,
}: {
  showRecommendedPreview: boolean
  workoutRecommendation?: WorkoutRecommendation | null
  activeRoutine: Routine | null
  exercises: Exercise[]
  sessions: SessionPayload[]
}) {
  return (
    <>
      {showRecommendedPreview && workoutRecommendation ? (
        <RecommendedExercisePreview workoutRecommendation={workoutRecommendation} exercises={exercises} />
      ) : activeRoutine && activeRoutine.items && activeRoutine.items.length > 0 ? (
        <RoutineExercisePreview activeRoutine={activeRoutine} exercises={exercises} sessions={sessions} />
      ) : null}
      {Boolean(workoutRecommendation?.research_citation) && workoutRecommendation && (
        <CollapsibleSection variant="inline" icon="📚" title={workoutRecommendation.research_citation ?? ''} className="mb-4">
          {INLINE_CITATION_PILLARS.map((pillar) => (
            <div key={pillar.label}>
              {pillar.icon} <strong>{pillar.label}</strong> {pillar.description}
            </div>
          ))}
        </CollapsibleSection>
      )}
    </>
  )
}

function TodayWorkoutAiModal({
  isOpen,
  onClose,
  workoutRecommendation,
  onSynthesize,
}: {
  isOpen: boolean
  onClose: () => void
  workoutRecommendation?: WorkoutRecommendation | null
  onSynthesize?: (customContext?: string) => Promise<void>
}) {
  if (!onSynthesize) return null
  return (
    <AiSynthesizerModal
      isOpen={isOpen}
      onClose={onClose}
      variant="brand"
      title="Adaptive Workout Synthesizer"
      subtitle="Hypertrophy Science & Biomechanics Grounding"
      citationTitle={workoutRecommendation?.research_citation || 'Israetel (Volume Landmarks) & Helms (RIR Autoregulation)'}
      pillars={WORKOUT_PILLARS}
      inputLabel="Constraints, Body State, or Schedule Shifts (Optional)"
      inputPlaceholder="e.g. Left shoulder is pinching on incline; only have 35 minutes today; badminton left my calves sore"
      inputRows={2}
      submitLabel="Synthesize Training"
      errorFallbackMessage="Workout synthesis failed. Please verify Muninn connection or try again."
      onSynthesize={onSynthesize}
    />
  )
}

/**
 * Displays today's training prescription, split-swap selector, exercise previews,
 * class-only completion badges, completion summary metrics, and AI workout modal.
 */
function useTodayTrainingState(
  routines: Routine[],
  exercises: Exercise[],
  sessions: SessionPayload[],
  circadianDate: string,
  workoutRecommendation?: WorkoutRecommendation | null
) {
  const [selectedRoutineOverride, setSelectedRoutineOverride] = useState<Routine | null>(null)
  const [showRoutinePicker, setShowRoutinePicker] = useState<boolean>(false)
  const [showWorkoutAiModal, setShowWorkoutAiModal] = useState<boolean>(false)
  const { activeRoutine, dayHeadline, daySubtitle } = resolveTodayRoutineState(routines, workoutRecommendation, selectedRoutineOverride)
  const summary = getCompletedTodaySummary(sessions, exercises, circadianDate)
  const showRecommendedPreview = Boolean(
    !selectedRoutineOverride && workoutRecommendation?.exercises && workoutRecommendation.exercises.length > 0
  )
  const startLabelName = selectedRoutineOverride?.name || workoutRecommendation?.routine_name || activeRoutine?.name
  const hasActionableStrength = Boolean(activeRoutine || showRecommendedPreview)
  const isLiftPendingAfterClass = summary.classSessions.length > 0 && !summary.hasCompletedPrimaryToday && hasActionableStrength
  const completedLabel = String(
    summary.latestSession?.extra?.routine_name ||
      (summary.latestSession && getSessionLabel(summary.latestSession, routines)) ||
      workoutRecommendation?.routine_name ||
      activeRoutine?.name ||
      "Today's Session"
  )
  return {
    selectedRoutineOverride,
    setSelectedRoutineOverride,
    showRoutinePicker,
    setShowRoutinePicker,
    showWorkoutAiModal,
    setShowWorkoutAiModal,
    activeRoutine,
    dayHeadline,
    daySubtitle,
    summary,
    showRecommendedPreview,
    startLabelName,
    hasActionableStrength,
    isLiftPendingAfterClass,
    completedLabel,
  }
}

export function TodayTrainingCard({
  circadianDate,
  workoutRecommendation,
  routines,
  exercises,
  sessions,
  isGeneratingWorkout,
  onStartRoutine,
  onSynthesizeWorkoutRecommendation,
}: TodayTrainingCardProps) {
  const s = useTodayTrainingState(routines, exercises, sessions, circadianDate, workoutRecommendation)

  return (
    <>
      <GlassCard className="animate-slide-up mb-4">
        <TodayTrainingHeader
          dayHeadline={s.dayHeadline}
          daySubtitle={s.daySubtitle}
          isLiftPendingAfterClass={s.isLiftPendingAfterClass}
          isGeneratingWorkout={isGeneratingWorkout}
          workoutRecommendation={workoutRecommendation}
          showRoutinePicker={s.showRoutinePicker}
          onOpenAiModal={() => s.setShowWorkoutAiModal(true)}
          onTogglePicker={() => s.setShowRoutinePicker(!s.showRoutinePicker)}
          hasAiHandler={Boolean(onSynthesizeWorkoutRecommendation)}
        />
        <TodayWorkoutRecommendationAlerts isGeneratingWorkout={isGeneratingWorkout} workoutRecommendation={workoutRecommendation} />
        {s.showRoutinePicker && (
          <RoutinePickerPanel
            routines={routines}
            activeRoutine={s.activeRoutine}
            selectedRoutineOverride={s.selectedRoutineOverride}
            recommendedRoutineName={workoutRecommendation?.routine_name}
            onSelectRoutine={(r) => { s.setSelectedRoutineOverride(r); s.setShowRoutinePicker(false) }}
            onReset={() => { s.setSelectedRoutineOverride(null); s.setShowRoutinePicker(false) }}
          />
        )}
        <TodayTrainingBody
          showRecommendedPreview={s.showRecommendedPreview}
          workoutRecommendation={workoutRecommendation}
          activeRoutine={s.activeRoutine}
          exercises={exercises}
          sessions={sessions}
        />
        <LoggedClassChips classSessions={s.summary.classSessions} routines={routines} />
        <TodayTrainingActionSection
          summary={s.summary}
          completedLabel={s.completedLabel}
          hasActionableStrength={s.hasActionableStrength}
          startLabelName={s.startLabelName}
          activeRoutine={s.activeRoutine}
          onStartRoutine={onStartRoutine}
        />
      </GlassCard>
      <TodayWorkoutAiModal
        isOpen={s.showWorkoutAiModal}
        onClose={() => s.setShowWorkoutAiModal(false)}
        workoutRecommendation={workoutRecommendation}
        onSynthesize={onSynthesizeWorkoutRecommendation}
      />
    </>
  )
}
