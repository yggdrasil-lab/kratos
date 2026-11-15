import { useState } from 'react'
import {
  AiSynthesizerModal,
  AlertBanner,
  Button,
  CollapsibleSection,
  GlassCard,
  SummaryMetricGrid,
} from '@yggdrasil-lab/ui'
import type { Exercise, Routine, SessionPayload, WorkoutRecommendation } from '../types'
import { resolveTodayRoutineState } from '../utils/readiness'
import { getSessionLabel, isPerHandExercise } from '../utils/session'
import { getCompletedTodaySummary, getExerciseGhostTarget } from '../utils/sessionMetrics'

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

/**
 * Displays today's training prescription, split-swap selector, exercise previews,
 * completion summary metrics, and AI workout synthesizer modal.
 */
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
  const [selectedRoutineOverride, setSelectedRoutineOverride] = useState<Routine | null>(null)
  const [showRoutinePicker, setShowRoutinePicker] = useState<boolean>(false)
  const [showWorkoutAiModal, setShowWorkoutAiModal] = useState<boolean>(false)

  const { activeRoutine, dayHeadline, daySubtitle } = resolveTodayRoutineState(
    routines,
    workoutRecommendation,
    selectedRoutineOverride
  )
  const summary = getCompletedTodaySummary(sessions, exercises, circadianDate)

  const showRecommendedPreview = Boolean(
    !selectedRoutineOverride &&
      workoutRecommendation?.exercises &&
      workoutRecommendation.exercises.length > 0
  )
  const startLabelName =
    selectedRoutineOverride?.name ||
    workoutRecommendation?.routine_name ||
    activeRoutine?.name

  const completedLabel = String(
    summary.latestSession?.extra?.routine_name ||
      (summary.latestSession && getSessionLabel(summary.latestSession, routines)) ||
      workoutRecommendation?.routine_name ||
      activeRoutine?.name ||
      "Today's Session"
  )

  return (
    <>
      <GlassCard className="animate-slide-up mb-4">
        <div className="flex justify-between items-start mb-3 gap-2">
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-sky-400 font-semibold uppercase">
                Today&apos;s Training
              </span>
              {isGeneratingWorkout && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold bg-amber-500/25 text-amber-300 animate-pulse">
                  ⚡ Synthesizing AI Training...
                </span>
              )}
              {workoutRecommendation?.is_llm_generated && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold bg-blue-500/25 text-blue-300">
                  ⚡ AI Autoregulated
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold my-0.5 text-slate-100">{dayHeadline}</h3>
            <p className="text-xs text-slate-400 m-0">{daySubtitle}</p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onSynthesizeWorkoutRecommendation && (
              <Button
                variant="outline"
                size="xs"
                icon={<span>⚡</span>}
                onClick={() => setShowWorkoutAiModal(true)}
                title="Autoregulate training with AI sports physiology"
                className="border-blue-500/40 text-blue-300"
              >
                Adapt
              </Button>
            )}

            <Button
              variant="secondary"
              size="xs"
              onClick={() => setShowRoutinePicker(!showRoutinePicker)}
            >
              {showRoutinePicker ? 'Close' : 'Swap Split'}
            </Button>
          </div>
        </div>

        {isGeneratingWorkout && !workoutRecommendation && (
          <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 mb-4 text-xs text-sky-200 flex items-center gap-2 animate-pulse">
            <span className="text-sm">⏳</span>
            <span>Synthesizing today&apos;s autoregulated training prescription and Discord thread...</span>
          </div>
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
            {workoutRecommendation.rationale} ({workoutRecommendation.volume_landmark} •{' '}
            {workoutRecommendation.target_rir})
          </AlertBanner>
        )}

        {showRoutinePicker && (
          <div className="bg-background/80 rounded-xl p-3 mb-4 flex flex-col gap-1.5 border border-border">
            <div className="text-xs font-semibold text-slate-300 mb-1">
              Pick another routine for today:
            </div>
            {selectedRoutineOverride && (
              <Button
                variant="outline"
                size="sm"
                fullWidth
                className="justify-start text-sky-300 border-sky-500/40 mb-1"
                onClick={() => {
                  setSelectedRoutineOverride(null)
                  setShowRoutinePicker(false)
                }}
              >
                ↺ Reset to Scheduled ({workoutRecommendation?.routine_name || 'Default'})
              </Button>
            )}
            {routines.map((r) => (
              <Button
                key={r.id}
                variant={activeRoutine?.id === r.id ? 'blue' : 'secondary'}
                size="sm"
                fullWidth
                className="justify-start"
                onClick={() => {
                  setSelectedRoutineOverride(r)
                  setShowRoutinePicker(false)
                }}
              >
                {r.name}
              </Button>
            ))}
          </div>
        )}

        {showRecommendedPreview && workoutRecommendation ? (
          <div className="flex flex-col gap-2 mb-4">
            {workoutRecommendation.exercises.map((recEx, idx) => {
              const matchEx = exercises.find(
                (e) => e.name.toLowerCase() === recEx.exercise_name.toLowerCase()
              )
              const isPerHand = isPerHandExercise(matchEx, recEx.weight_basis, recEx.exercise_name)
              return (
                <div
                  key={idx}
                  className="bg-background/60 rounded-xl px-3.5 py-2.5 flex flex-col gap-1 border border-border/60"
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-semibold">{idx + 1}.</span>
                      <span className="text-sm font-semibold text-slate-100">
                        {recEx.exercise_name}
                      </span>
                    </div>
                    <span className="text-xs text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md font-semibold shrink-0">
                      {recEx.suggested_weight_kg
                        ? `${recEx.suggested_weight_kg}kg${isPerHand ? ' per hand' : ''} • `
                        : ''}
                      {recEx.target_sets} sets x {recEx.target_reps}
                    </span>
                  </div>
                  {recEx.notes && (
                    <div className="text-xs text-slate-300 pl-4">Cue: {recEx.notes}</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : activeRoutine && activeRoutine.items && activeRoutine.items.length > 0 ? (
          <div className="flex flex-col gap-2 mb-4">
            {activeRoutine.items.map((it, idx) => {
              const ex = exercises.find((e) => e.id === it.exercise_id)
              const exName = ex ? ex.name : `Exercise ${idx + 1}`
              const isPerHand = isPerHandExercise(ex, undefined, exName)
              const ghost = getExerciseGhostTarget(it.exercise_id, sessions)

              return (
                <div
                  key={it.id}
                  className="bg-background/60 rounded-xl px-3.5 py-2.5 flex justify-between items-center border border-border/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-semibold">{idx + 1}.</span>
                    <span className="text-sm font-semibold text-slate-100">{exName}</span>
                  </div>

                  {ghost && ghost.weightKg !== null ? (
                    <span className="text-xs text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md">
                      Last: {ghost.weightKg}kg{isPerHand ? ' per hand' : ''} x{' '}
                      {ghost.reps ?? 'failure'}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">2 sets to failure</span>
                  )}
                </div>
              )
            })}
          </div>
        ) : null}

        {workoutRecommendation?.research_citation && (
          <CollapsibleSection
            variant="inline"
            icon="📚"
            title={workoutRecommendation.research_citation}
            className="mb-4"
          >
            <div>
              📊 <strong>Israetel (RP):</strong> Sets scaled between MEV (2 sets deload on fatigue)
              and MAV (3+ overload sets).
            </div>
            <div>
              🎯 <strong>Helms:</strong> Target RIR dictated by recovery score (RIR 1-2 on primed
              days; RIR 3-4 on fatigue).
            </div>
            <div>
              🛡️ <strong>McGill / Starrett:</strong> Neutral grips and joint-sparing substitutions
              when friction is detected.
            </div>
            <div>
              🏸 <strong>Concurrent Interference:</strong> Preserves leg power adjacent to badminton
              match play.
            </div>
          </CollapsibleSection>
        )}

        {summary.hasCompletedToday ? (
          <div className="space-y-3" data-testid="completed-workout-card">
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
              <div className="inline-flex items-center justify-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2">
                <span>Completed ✓</span>
              </div>
              <div className="text-sm font-semibold text-slate-200 mb-2">{completedLabel}</div>
              <SummaryMetricGrid
                columns={3}
                className="pt-2 border-t border-emerald-500/20"
                items={[
                  { id: 'duration', label: 'Duration', value: `${summary.totalDurationMins}m` },
                  { id: 'sets', label: 'Total Sets', value: summary.totalSets },
                  {
                    id: 'volume',
                    label: 'Volume',
                    value: `${summary.totalVolumeKg.toLocaleString()} kg`,
                  },
                ]}
              />
            </div>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              onClick={() => onStartRoutine(activeRoutine || undefined)}
            >
              Start Another Session ({startLabelName || 'Workout'})
            </Button>
          </div>
        ) : activeRoutine || showRecommendedPreview ? (
          <Button
            variant="blue"
            size="lg"
            fullWidth
            onClick={() => onStartRoutine(activeRoutine || undefined)}
          >
            Start Workout ({startLabelName || 'Session'})
          </Button>
        ) : (
          <div className="text-center space-y-3">
            <p className="text-xs text-slate-300 m-0">
              No routine scheduled for today. Configure routines in the Plan tab or tap Adapt to
              synthesize with AI.
            </p>
          </div>
        )}
      </GlassCard>

      {onSynthesizeWorkoutRecommendation && (
        <AiSynthesizerModal
          isOpen={showWorkoutAiModal}
          onClose={() => setShowWorkoutAiModal(false)}
          title="Adaptive Workout Synthesizer"
          subtitle="Hypertrophy Science & Biomechanics Grounding"
          citationTitle={
            workoutRecommendation?.research_citation ||
            'Israetel (Volume Landmarks) & Helms (RIR Autoregulation)'
          }
          pillars={WORKOUT_PILLARS}
          inputLabel="Constraints, Body State, or Schedule Shifts (Optional)"
          inputPlaceholder="e.g. Left shoulder is pinching on incline; only have 35 minutes today; badminton left my calves sore"
          inputRows={2}
          submitLabel="Synthesize Training"
          errorFallbackMessage="Workout synthesis failed. Please verify Muninn connection or try again."
          onSynthesize={onSynthesizeWorkoutRecommendation}
        />
      )}
    </>
  )
}
