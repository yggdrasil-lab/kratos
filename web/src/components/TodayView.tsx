import { useState } from 'react'
import { GlassCard, Button, AlertBanner, CollapsibleSection, AiSynthesizerModal } from '@yggdrasil-lab/ui'
import type { DailyBiometrics, Exercise, FastingCheckIn, FastingRecommendation, Routine, SessionPayload, WorkoutRecommendation } from '../types'
import { DAY_NAMES, DAY_SHORTS, formatFriendlyDate } from '../utils/circadian'
import { getSessionLabel } from '../utils/session'
import { FastingCard } from './FastingCard'

interface TodayViewProps {
  circadianDate: string
  dayOfWeek: number
  biometrics: DailyBiometrics | null
  fastingRecommendation?: FastingRecommendation | null
  workoutRecommendation?: WorkoutRecommendation | null
  routines: Routine[]
  exercises: Exercise[]
  sessions: SessionPayload[]
  latestFastingCheckIn?: FastingCheckIn
  onStartRoutine: (routine?: Routine) => void
  onSaveFastingCheckIn: (checkIn: FastingCheckIn) => void
  onSynthesizeFastingRecommendation?: (customContext?: string) => Promise<void>
  onSynthesizeWorkoutRecommendation?: (customContext?: string) => Promise<void>
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession?: (session: SessionPayload) => void
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

export function TodayView({
  circadianDate,
  dayOfWeek,
  biometrics,
  fastingRecommendation,
  workoutRecommendation,
  routines,
  exercises,
  sessions,
  latestFastingCheckIn,
  onStartRoutine,
  onSaveFastingCheckIn,
  onSynthesizeFastingRecommendation,
  onSynthesizeWorkoutRecommendation,
  onDeleteSession,
  onConfirmSession,
  onEditSession,
}: TodayViewProps) {
  const [selectedRoutineOverride, setSelectedRoutineOverride] = useState<Routine | null>(null)
  const [showRoutinePicker, setShowRoutinePicker] = useState<boolean>(false)
  const [showWorkoutAiModal, setShowWorkoutAiModal] = useState<boolean>(false)

  const sleepHours = biometrics?.sleep_duration_hours ?? null
  const hrvMs = biometrics?.hrv_ms ? Number(biometrics.hrv_ms) : null
  const rhrBpm = biometrics?.resting_hr_bpm ?? null
  const weightKg = biometrics?.latest_weight_kg ? Number(biometrics.latest_weight_kg) : null

  let readinessBadge = {
    emoji: '🟢',
    label: 'High Readiness',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
    message: 'Optimal state. Prime day to push progressive overload and PRs.',
  }

  if (sleepHours !== null && sleepHours < 5.5) {
    readinessBadge = {
      emoji: '🔴',
      label: 'Low Recovery',
      textClass: 'text-rose-400',
      borderClass: 'border-rose-500/30',
      message: 'Short sleep detected (<5.5h). Recommend volume scaling or posture mobility.',
    }
  } else if ((sleepHours !== null && sleepHours < 6.8) || (hrvMs !== null && hrvMs < 42)) {
    readinessBadge = {
      emoji: '🟡',
      label: 'Moderate Fatigue',
      textClass: 'text-amber-400',
      borderClass: 'border-amber-500/30',
      message: 'Moderate recovery. Keep form tight and cap intensity around RPE 7-8.',
    }
  }

  // Derive routine from recommendation or PostgreSQL database routines
  const recommendedRoutineName = workoutRecommendation?.routine_name
  const matchedRecommendedRoutine = recommendedRoutineName
    ? routines.find((r) => r.name.toLowerCase() === recommendedRoutineName.toLowerCase()) || null
    : null

  const defaultRoutine: Routine | null =
    matchedRecommendedRoutine ||
    (routines.length > 0 ? routines[dayOfWeek % routines.length] : null)

  const activeRoutine = selectedRoutineOverride || defaultRoutine

  const dayHeadline = workoutRecommendation?.routine_name || activeRoutine?.name || 'Rest & Recovery'
  const daySubtitle = workoutRecommendation?.exercises && workoutRecommendation.exercises.length > 0
    ? `${workoutRecommendation.exercises.length} autoregulated exercises`
    : activeRoutine?.items && activeRoutine.items.length > 0
    ? `${activeRoutine.items.length} exercises configured`
    : 'No routines scheduled for today'

  const getExerciseGhostTarget = (exerciseId: string) => {
    for (const sess of sessions) {
      const matchItem = sess.items.find((it) => it.exercise_id === exerciseId)
      if (matchItem) {
        const doneSets = matchItem.sets.filter((s) => s.status === 'done' && (s.weight_kg !== null || s.reps !== null))
        if (doneSets.length > 0) {
          const heaviest = [...doneSets].sort((a, b) => (b.weight_kg ?? 0) - (a.weight_kg ?? 0))[0]
          return {
            weightKg: heaviest.weight_kg,
            reps: heaviest.reps,
          }
        }
      }
    }
    return null
  }

  const weekDaySessions: boolean[] = [false, false, false, false, false, false, false]
  const todayDate = new Date()
  const monday = new Date(todayDate)
  monday.setDate(todayDate.getDate() - dayOfWeek)
  monday.setHours(0, 0, 0, 0)

  sessions.forEach((s) => {
    const sDate = new Date(s.started_at)
    const diffDays = Math.floor((sDate.getTime() - monday.getTime()) / (24 * 3600 * 1000))
    if (diffDays >= 0 && diffDays < 7) {
      weekDaySessions[diffDays] = true
    }
  })

  const inferredSessions = sessions.filter((s) => Boolean(s.extra?.inferred))

  return (
    <div className="animate-fade-in pb-16">
      {/* Date and Welcome Header */}
      <div className="mb-5">
        <div className="text-xs text-slate-400 uppercase tracking-wider">
          {DAY_NAMES[dayOfWeek]} • Auckland
        </div>
        <h2 className="text-2xl font-bold m-0 mt-0.5 text-slate-100">
          {formatFriendlyDate(circadianDate)}
        </h2>
      </div>

      {/* Auto-Detected / Inferred Workout Review Banner */}
      {inferredSessions.length > 0 && (
        <div className="flex flex-col gap-3 mb-5">
          {inferredSessions.map((infSession) => {
            const routineName = getSessionLabel(infSession, routines)
            const sessionDate = infSession.started_at ? infSession.started_at.split('T')[0] : circadianDate
            const durationMins = infSession.ended_at && infSession.started_at
              ? Math.max(1, Math.round((new Date(infSession.ended_at).getTime() - new Date(infSession.started_at).getTime()) / 60000))
              : (infSession.extra?.duration_minutes as number | undefined) || null

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
                </div>

                <div className="mb-2">
                  <div className="text-base font-bold text-slate-100">
                    {routineName}
                  </div>
                  <div className="text-xs text-slate-300 mt-0.5 flex gap-3 flex-wrap">
                    {durationMins ? <span>⏱️ ~{durationMins} min</span> : null}
                    {infSession.extra?.active_energy_kcal ? (
                      <span>🔥 {String(infSession.extra.active_energy_kcal)} kcal</span>
                    ) : null}
                    {infSession.extra?.avg_hr ? (
                      <span>💓 ~{String(infSession.extra.avg_hr)} bpm</span>
                    ) : null}
                  </div>
                </div>

                <p className="text-xs text-amber-200/90 mb-3">
                  Auto-attached from plan and wearable biometrics. Did you complete this workout?
                </p>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="blue"
                    size="xs"
                    onClick={() => onConfirmSession(infSession.id)}
                  >
                    ✓ Confirm / Keep
                  </Button>
                  {onEditSession && (
                    <Button
                      variant="secondary"
                      size="xs"
                      onClick={() => onEditSession(infSession)}
                    >
                      Change
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="xs"
                    onClick={() => onDeleteSession(infSession.id)}
                  >
                    ✕ Dismiss Workout
                  </Button>
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}

      {/* 1. Readiness and Vitals Badge */}
      <GlassCard className={`animate-slide-up mb-5 ${readinessBadge.borderClass}`}>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <span className="text-lg">{readinessBadge.emoji}</span>
            <span className={`font-bold text-sm ${readinessBadge.textClass}`}>
              {readinessBadge.label}
            </span>
          </div>
          {weightKg !== null && (
            <span className="text-xs text-slate-300 font-semibold">
              ⚖️ {weightKg.toFixed(1)} kg
            </span>
          )}
        </div>

        <p className="text-xs text-slate-300 mb-3">
          {readinessBadge.message}
        </p>

        <div className="flex gap-2 flex-wrap">
          {sleepHours !== null && (
            <div className="bg-background/70 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-border/50">
              😴 Sleep: <strong className="text-slate-100">{sleepHours.toFixed(1)}h</strong>
              {biometrics?.sleep_deep_hours ? ` (${biometrics.sleep_deep_hours.toFixed(1)}h deep)` : ''}
            </div>
          )}
          {hrvMs !== null && (
            <div className="bg-background/70 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-border/50">
              💓 HRV: <strong className="text-slate-100">{Math.round(hrvMs)} ms</strong>
            </div>
          )}
          {rhrBpm !== null && (
            <div className="bg-background/70 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-border/50">
              🫀 RHR: <strong className="text-slate-100">{rhrBpm} bpm</strong>
            </div>
          )}
        </div>
      </GlassCard>

      {/* 2. Fasting and Fueling Plan */}
      <FastingCard
        circadianDate={circadianDate}
        dayOfWeek={dayOfWeek}
        latestCheckIn={latestFastingCheckIn}
        recommendation={fastingRecommendation}
        onSaveCheckIn={onSaveFastingCheckIn}
        onSynthesizeRecommendation={onSynthesizeFastingRecommendation}
      />

      {/* 3. Today's Training Card */}
      <GlassCard className="animate-slide-up mb-6">
        <div className="flex justify-between items-start mb-3 gap-2">
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-sky-400 font-semibold uppercase">
                Today's Training
              </span>
              {workoutRecommendation?.is_llm_generated && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold bg-blue-500/25 text-blue-300">
                  ⚡ AI Autoregulated
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold my-0.5 text-slate-100">
              {workoutRecommendation?.routine_name ?? (activeRoutine ? activeRoutine.name : dayHeadline)}
            </h3>
            <p className="text-xs text-slate-400 m-0">
              {daySubtitle}
            </p>
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

        {/* Readiness Adaptation Banner */}
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

        {/* Routine Swap Selector */}
        {showRoutinePicker && (
          <div className="bg-background/80 rounded-xl p-3 mb-4 flex flex-col gap-1.5 border border-border">
            <div className="text-xs font-semibold text-slate-300 mb-1">
              Pick another routine for today:
            </div>
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

        {/* Exercise Preview */}
        {workoutRecommendation?.exercises && workoutRecommendation.exercises.length > 0 ? (
          <div className="flex flex-col gap-2 mb-5">
            {workoutRecommendation.exercises.map((recEx, idx) => {
              const isPerHand =
                recEx.weight_basis === 'per_hand' ||
                recEx.exercise_name.toLowerCase().includes('dumbbell') ||
                recEx.exercise_name.toLowerCase().includes('db ')
              return (
                <div
                  key={idx}
                  className="bg-background/60 rounded-xl px-3.5 py-2.5 flex flex-col gap-1 border border-border/60"
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-semibold">{idx + 1}.</span>
                      <span className="text-sm font-semibold text-slate-100">{recEx.exercise_name}</span>
                    </div>
                    <span className="text-xs text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md font-semibold shrink-0">
                      {recEx.suggested_weight_kg
                        ? `${recEx.suggested_weight_kg}kg${isPerHand ? ' per hand' : ''} • `
                        : ''}
                      {recEx.target_sets} sets x {recEx.target_reps}
                    </span>
                  </div>
                  {recEx.notes && (
                    <div className="text-xs text-slate-300 pl-5 italic">
                      Cue: {recEx.notes}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : activeRoutine && activeRoutine.items && activeRoutine.items.length > 0 ? (
          <div className="flex flex-col gap-2 mb-5">
            {activeRoutine.items.map((it, idx) => {
              const ex = exercises.find((e) => e.id === it.exercise_id)
              const exName = ex ? ex.name : `Exercise ${idx + 1}`
              const isPerHand =
                ex?.weight_basis === 'per_hand' ||
                exName.toLowerCase().includes('dumbbell') ||
                exName.toLowerCase().includes('db ')
              const ghost = getExerciseGhostTarget(it.exercise_id)

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
                      Last: {ghost.weightKg}kg{isPerHand ? ' per hand' : ''} x {ghost.reps ?? 'failure'}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">
                      2 sets to failure
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ) : null}

        {/* Research Grounding Accordion */}
        {workoutRecommendation?.research_citation && (
          <CollapsibleSection
            variant="inline"
            icon="📚"
            title={workoutRecommendation.research_citation}
            className="mb-4"
          >
            <div>📊 <strong>Israetel (RP):</strong> Sets scaled between MEV (2 sets deload on fatigue) and MAV (3+ overload sets).</div>
            <div>🎯 <strong>Helms:</strong> Target RIR dictated by recovery score (RIR 1-2 on primed days; RIR 3-4 on fatigue).</div>
            <div>🛡️ <strong>McGill / Starrett:</strong> Neutral grips and joint-sparing substitutions when friction is detected.</div>
            <div>🏸 <strong>Concurrent Interference:</strong> Preserves leg power adjacent to badminton match play.</div>
          </CollapsibleSection>
        )}

        {/* Action Button */}
        {activeRoutine || (workoutRecommendation?.exercises && workoutRecommendation.exercises.length > 0) ? (
          <Button
            variant="blue"
            size="lg"
            fullWidth
            onClick={() => onStartRoutine(activeRoutine || undefined)}
          >
            Start Workout ({workoutRecommendation?.routine_name || activeRoutine?.name || 'Session'})
          </Button>
        ) : (
          <div className="text-center space-y-3">
            <p className="text-xs text-slate-300 m-0">
              No routine scheduled for today. Configure routines in the Plan tab or tap Adapt to synthesize with AI.
            </p>
            {routines.length > 0 && (
              <Button variant="secondary" size="md" onClick={() => onStartRoutine(routines[0])}>
                Start {routines[0].name}
              </Button>
            )}
          </div>
        )}
      </GlassCard>

      {/* 4. Weekly Rhythm Mini-Bar */}
      <GlassCard className="animate-slide-up py-4 px-5">
        <div className="text-xs text-slate-400 font-semibold uppercase mb-2.5">
          Weekly Rhythm (Mon - Sun)
        </div>
        <div className="flex justify-between gap-1.5">
          {DAY_SHORTS.map((shortName, idx) => {
            const isToday = idx === dayOfWeek
            const isCompleted = weekDaySessions[idx]

            let icon = '○'
            let boxClass = 'bg-background/50 border-border/60'
            let iconColor = 'text-slate-400'

            if (isCompleted) {
              icon = '✓'
              boxClass = 'bg-emerald-500/20 border-emerald-500'
              iconColor = 'text-emerald-400'
            }

            if (isToday) {
              boxClass = 'bg-blue-500/20 border-blue-500'
            }

            return (
              <div
                key={shortName}
                className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border ${boxClass}`}
              >
                <span className={`text-[11px] ${isToday ? 'text-sky-400 font-bold' : 'text-slate-400 font-medium'}`}>
                  {shortName}
                </span>
                <span className={`text-xs font-bold ${iconColor}`}>
                  {icon}
                </span>
              </div>
            )
          })}
        </div>
      </GlassCard>

      {/* 5. Workout AI Modal */}
      {onSynthesizeWorkoutRecommendation && (
        <AiSynthesizerModal
          isOpen={showWorkoutAiModal}
          onClose={() => setShowWorkoutAiModal(false)}
          title="Adaptive Workout Synthesizer"
          subtitle="Hypertrophy Science & Biomechanics Grounding"
          citationTitle={workoutRecommendation?.research_citation || 'Israetel (Volume Landmarks) & Helms (RIR Autoregulation)'}
          pillars={WORKOUT_PILLARS}
          inputLabel="Constraints, Body State, or Schedule Shifts (Optional)"
          inputPlaceholder="e.g. Left shoulder is pinching on incline; only have 35 minutes today; badminton left my calves sore"
          inputRows={2}
          submitLabel="Synthesize Training"
          errorFallbackMessage="Workout synthesis failed. Please verify Muninn connection or try again."
          onSynthesize={onSynthesizeWorkoutRecommendation}
        />
      )}
    </div>
  )
}
