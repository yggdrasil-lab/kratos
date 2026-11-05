import { useState } from 'react'
import type { DailyBiometrics, Exercise, FastingCheckIn, FastingRecommendation, Routine, SessionPayload, WorkoutRecommendation } from '../types'
import { DAY_NAMES, DAY_SHORTS, formatFriendlyDate } from '../utils/circadian'
import { FastingCard } from './FastingCard'
import { WorkoutAiModal } from './WorkoutAiModal'

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
  onStartRoutine: (routine: Routine) => void
  onSaveFastingCheckIn: (checkIn: FastingCheckIn) => void
  onSynthesizeFastingRecommendation?: (customContext?: string) => Promise<void>
  onSynthesizeWorkoutRecommendation?: (customContext?: string) => Promise<void>
}

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
}: TodayViewProps) {
  const [selectedRoutineOverride, setSelectedRoutineOverride] = useState<Routine | null>(null)
  const [showRoutinePicker, setShowRoutinePicker] = useState<boolean>(false)
  const [showWorkoutAiModal, setShowWorkoutAiModal] = useState<boolean>(false)
  const [showWorkoutResearch, setShowWorkoutResearch] = useState<boolean>(false)

  // 1. Calculate readiness from biometrics
  const sleepHours = biometrics?.sleep_duration_hours ?? null
  const hrvMs = biometrics?.hrv_ms ? Number(biometrics.hrv_ms) : null
  const rhrBpm = biometrics?.resting_hr_bpm ?? null
  const weightKg = biometrics?.latest_weight_kg ? Number(biometrics.latest_weight_kg) : null

  let readinessBadge = {
    emoji: '🟢',
    label: 'High Readiness',
    color: '#10b981',
    message: 'Optimal state. Prime day to push progressive overload and PRs.',
  }

  if (sleepHours !== null && sleepHours < 5.5) {
    readinessBadge = {
      emoji: '🔴',
      label: 'Low Recovery',
      color: '#ef4444',
      message: 'Short sleep detected (<5.5h). Recommend volume scaling or posture mobility.',
    }
  } else if ((sleepHours !== null && sleepHours < 6.8) || (hrvMs !== null && hrvMs < 42)) {
    readinessBadge = {
      emoji: '🟡',
      label: 'Moderate Fatigue',
      color: '#f59e0b',
      message: 'Moderate recovery. Keep form tight and cap intensity around RPE 7-8.',
    }
  }

  // 2. Select default routine based on day of week
  const upperARoutine = routines.find((r) => r.name.toLowerCase().includes('upper') && r.name.toLowerCase().includes('a')) || routines[0]
  const lowerARoutine = routines.find((r) => r.name.toLowerCase().includes('lower') && r.name.toLowerCase().includes('a')) || routines[1] || routines[0]
  const upperBRoutine = routines.find((r) => r.name.toLowerCase().includes('upper') && r.name.toLowerCase().includes('b')) || routines[0]
  const lowerBRoutine = routines.find((r) => r.name.toLowerCase().includes('lower') && r.name.toLowerCase().includes('b')) || routines[1] || routines[0]

  let defaultRoutine: Routine | null = upperARoutine
  let dayType: 'lift' | 'sport' | 'rest' = 'lift'
  let dayHeadline = 'Upper Body A (Chest and Vertical Pull)'
  let daySubtitle = '4 exercises x 2 sets to failure'

  if (dayOfWeek === 1) {
    // Tuesday: Badminton
    dayType = 'sport'
    defaultRoutine = null
    dayHeadline = '🏸 Badminton Match Play'
    daySubtitle = '7:00 PM - 9:00 PM court time. Daytime focus: mobility and hydration.'
  } else if (dayOfWeek === 2) {
    // Wednesday: Lower Body
    dayType = 'lift'
    defaultRoutine = lowerARoutine
    dayHeadline = 'Lower Body A (Squat and Hinge)'
    daySubtitle = '4 exercises x 2 sets to failure'
  } else if (dayOfWeek === 3) {
    // Thursday: Badminton
    dayType = 'sport'
    defaultRoutine = null
    dayHeadline = '🏸 Badminton Match Play'
    daySubtitle = '7:00 PM - 9:00 PM court time. Daytime focus: mobility and hydration.'
  } else if (dayOfWeek === 4) {
    // Friday: Rest and Fast
    dayType = 'rest'
    defaultRoutine = null
    dayHeadline = '🧘 Rest and Deep Fast Day'
    daySubtitle = 'Zero axial lifting. 18h+ intermittent fast and electrolyte hydration.'
  } else if (dayOfWeek === 5) {
    // Saturday: Upper B
    dayType = 'lift'
    defaultRoutine = upperBRoutine
    dayHeadline = 'Upper Body B (Arms, Back and Delts)'
    daySubtitle = '4 exercises x 2 sets to failure'
  } else if (dayOfWeek === 6) {
    // Sunday: Lower B
    dayType = 'lift'
    defaultRoutine = lowerBRoutine
    dayHeadline = 'Lower Body B (Kettlebell, Lunge and Core)'
    daySubtitle = '4 exercises x 2 sets to failure'
  }

  const activeRoutine = selectedRoutineOverride || defaultRoutine

  // 3. Helper to find ghost targets (last performance) for an exercise
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

  // 4. Calculate Weekly Momentum (Monday to Sunday)
  // Find sessions completed in current week
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

  return (
    <div className="animate-fade-in" style={{ paddingBottom: '5rem' }}>
      {/* Date and Welcome Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {DAY_NAMES[dayOfWeek]} • Auckland
        </div>
        <h2 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0.1rem 0' }}>
          {formatFriendlyDate(circadianDate)}
        </h2>
      </div>

      {/* 1. Readiness and Vitals Badge */}
      <div className="glass-panel animate-slide-up" style={{
        marginBottom: '1.25rem',
        padding: '1.25rem',
        border: `1px solid ${readinessBadge.color}33`,
        background: `linear-gradient(135deg, ${readinessBadge.color}15, rgba(15, 23, 42, 0.6))`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.1rem' }}>{readinessBadge.emoji}</span>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: readinessBadge.color }}>
              {readinessBadge.label}
            </span>
          </div>
          {weightKg !== null && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              ⚖️ {weightKg.toFixed(1)} kg
            </span>
          )}
        </div>

        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.85rem' }}>
          {readinessBadge.message}
        </p>

        {/* Telemetry pill row */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {sleepHours !== null && (
            <div style={{ backgroundColor: 'rgba(0,0,0,0.25)', padding: '0.3rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.75rem' }}>
              😴 Sleep: <strong style={{ color: 'var(--text-primary)' }}>{sleepHours.toFixed(1)}h</strong>
              {biometrics?.sleep_deep_hours ? ` (${biometrics.sleep_deep_hours.toFixed(1)}h deep)` : ''}
            </div>
          )}
          {hrvMs !== null && (
            <div style={{ backgroundColor: 'rgba(0,0,0,0.25)', padding: '0.3rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.75rem' }}>
              💓 HRV: <strong style={{ color: 'var(--text-primary)' }}>{Math.round(hrvMs)} ms</strong>
            </div>
          )}
          {rhrBpm !== null && (
            <div style={{ backgroundColor: 'rgba(0,0,0,0.25)', padding: '0.3rem 0.6rem', borderRadius: '0.5rem', fontSize: '0.75rem' }}>
              🫀 RHR: <strong style={{ color: 'var(--text-primary)' }}>{rhrBpm} bpm</strong>
            </div>
          )}
        </div>
      </div>

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
      <div className="glass-panel animate-slide-up" style={{
        marginBottom: '1.5rem',
        padding: '1.25rem',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--primary-hover)', fontWeight: 600, textTransform: 'uppercase' }}>
                Today's Training
              </span>
              {workoutRecommendation?.is_llm_generated && (
                <span style={{
                  fontSize: '0.65rem',
                  padding: '0.1rem 0.4rem',
                  borderRadius: '0.4rem',
                  fontWeight: 600,
                  backgroundColor: 'rgba(59, 130, 246, 0.25)',
                  color: '#93c5fd',
                }}>
                  ⚡ AI Autoregulated
                </span>
              )}
            </div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0.2rem 0' }}>
              {workoutRecommendation?.routine_name ?? (activeRoutine ? activeRoutine.name : dayHeadline)}
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {daySubtitle}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            {onSynthesizeWorkoutRecommendation && (
              <button
                type="button"
                onClick={() => setShowWorkoutAiModal(true)}
                style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  borderRadius: '0.5rem',
                  color: '#93c5fd',
                  padding: '0.35rem 0.6rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  cursor: 'pointer',
                }}
                title="Autoregulate training with AI sports physiology"
              >
                <span>⚡</span>
                <span>Adapt</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowRoutinePicker(!showRoutinePicker)}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--surface-border)',
                borderRadius: '0.5rem',
                color: 'var(--text-secondary)',
                padding: '0.35rem 0.65rem',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              {showRoutinePicker ? 'Close' : 'Swap Split'}
            </button>
          </div>
        </div>

        {/* Readiness Adaptation Banner */}
        {workoutRecommendation && (
          <div style={{
            backgroundColor: workoutRecommendation.recovery_status === 'fatigued'
              ? 'rgba(239, 68, 68, 0.12)'
              : workoutRecommendation.recovery_status === 'moderate'
              ? 'rgba(245, 158, 11, 0.12)'
              : 'rgba(16, 185, 129, 0.12)',
            border: workoutRecommendation.recovery_status === 'fatigued'
              ? '1px solid rgba(239, 68, 68, 0.3)'
              : workoutRecommendation.recovery_status === 'moderate'
              ? '1px solid rgba(245, 158, 11, 0.3)'
              : '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '0.5rem',
            padding: '0.65rem 0.85rem',
            marginBottom: '1rem',
            fontSize: '0.78rem',
            color: workoutRecommendation.recovery_status === 'fatigued' ? '#fca5a5' : workoutRecommendation.recovery_status === 'moderate' ? '#fde68a' : '#a7f3d0',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
          }}>
            <span style={{ fontSize: '0.95rem', lineHeight: 1.2 }}>
              {workoutRecommendation.recovery_status === 'fatigued' ? '🛡️' : '🎯'}
            </span>
            <div style={{ flex: 1, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.15rem' }}>
                {workoutRecommendation.readiness_adaptation}
              </div>
              <div style={{ fontSize: '0.74rem', opacity: 0.9 }}>
                {workoutRecommendation.rationale} ({workoutRecommendation.volume_landmark} • {workoutRecommendation.target_rir})
              </div>
            </div>
          </div>
        )}

        {/* Routine Swap Selector */}
        {showRoutinePicker && (
          <div style={{
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '0.6rem',
            padding: '0.75rem',
            marginBottom: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
              Pick another routine for today:
            </div>
            {routines.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  setSelectedRoutineOverride(r)
                  setShowRoutinePicker(false)
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '0.4rem',
                  backgroundColor: activeRoutine?.id === r.id ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                  border: `1px solid ${activeRoutine?.id === r.id ? 'var(--primary-color)' : 'transparent'}`,
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}

        {/* Exercise Preview with Autoregulated Targets or Ghost Targets */}
        {workoutRecommendation?.exercises && workoutRecommendation.exercises.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {workoutRecommendation.exercises.map((recEx, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '0.5rem',
                  padding: '0.65rem 0.85rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                  border: '1px solid rgba(255, 255, 255, 0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}.</span>
                    <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{recEx.exercise_name}</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#c084fc', backgroundColor: 'rgba(139, 92, 246, 0.12)', padding: '0.2rem 0.5rem', borderRadius: '0.3rem', fontWeight: 600 }}>
                    {recEx.suggested_weight_kg ? `${recEx.suggested_weight_kg}kg • ` : ''}{recEx.target_sets} sets x {recEx.target_reps}
                  </span>
                </div>
                {recEx.notes && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', paddingLeft: '1.2rem', fontStyle: 'italic' }}>
                    Cue: {recEx.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : activeRoutine && activeRoutine.items && activeRoutine.items.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
            {activeRoutine.items.map((it, idx) => {
              const ex = exercises.find((e) => e.id === it.exercise_id)
              const exName = ex ? ex.name : `Exercise ${idx + 1}`
              const ghost = getExerciseGhostTarget(it.exercise_id)

              return (
                <div
                  key={it.id}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: '0.5rem',
                    padding: '0.6rem 0.8rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: '1px solid rgba(255, 255, 255, 0.04)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{idx + 1}.</span>
                    <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{exName}</span>
                  </div>

                  {ghost && ghost.weightKg !== null ? (
                    <span style={{ fontSize: '0.75rem', color: '#c084fc', backgroundColor: 'rgba(139, 92, 246, 0.12)', padding: '0.2rem 0.5rem', borderRadius: '0.3rem' }}>
                      Last: {ghost.weightKg}kg x {ghost.reps ?? 'failure'}
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
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
          <div style={{ marginBottom: '1rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
            <button
              type="button"
              onClick={() => setShowWorkoutResearch((prev) => !prev)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                color: '#60a5fa',
                fontSize: '0.72rem',
                cursor: 'pointer',
              }}
            >
              <span>📚</span>
              <span style={{ textDecoration: 'underline' }}>{workoutRecommendation.research_citation}</span>
              <span style={{ fontSize: '0.65rem' }}>{showWorkoutResearch ? '▲' : '▼'}</span>
            </button>
            {showWorkoutResearch && (
              <div style={{
                marginTop: '0.4rem',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.4rem',
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.45,
              }}>
                <div>📊 <strong>Israetel (RP):</strong> Sets scaled between MEV (2 sets deload on fatigue) and MAV (3+ overload sets).</div>
                <div>🎯 <strong>Helms:</strong> Target RIR dictated by recovery score (RIR 1-2 on primed days; RIR 3-4 on fatigue).</div>
                <div>🛡️ <strong>McGill / Starrett:</strong> Neutral grips and joint-sparing substitutions when friction is detected.</div>
                <div>🏸 <strong>Concurrent Interference:</strong> Preserves leg power adjacent to badminton match play.</div>
              </div>
            )}
          </div>
        )}

        {/* Action Button */}
        {activeRoutine ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => onStartRoutine(activeRoutine)}
            style={{
              width: '100%',
              padding: '0.9rem',
              fontSize: '1rem',
              fontWeight: 700,
              boxShadow: '0 4px 20px rgba(59, 130, 246, 0.4)',
            }}
          >
            Start Workout ({activeRoutine.name})
          </button>
        ) : dayType === 'sport' ? (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Badminton court scheduled for this evening. Rest up your legs!
            </p>
            {upperARoutine && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onStartRoutine(upperARoutine)}
                style={{ padding: '0.6rem 1rem', fontSize: '0.85rem' }}
              >
                Lift anyway (Upper Body)
              </button>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Rest day. Enjoy the extended fast and hydration.
            </p>
            {upperARoutine && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onStartRoutine(upperARoutine)}
                style={{ padding: '0.6rem 1rem', fontSize: '0.85rem' }}
              >
                Log a workout instead
              </button>
            )}
          </div>
        )}
      </div>

      {/* 4. Weekly Rhythm Mini-Bar */}
      <div className="glass-panel animate-slide-up" style={{ padding: '1rem 1.25rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.6rem' }}>
          Weekly Rhythm (Mon - Sun)
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.25rem' }}>
          {DAY_SHORTS.map((shortName, idx) => {
            const isToday = idx === dayOfWeek
            const isCompleted = weekDaySessions[idx]
            const isBadminton = idx === 1 || idx === 3
            const isFastDay = idx === 4

            let icon = '○'
            let bg = 'rgba(255, 255, 255, 0.03)'
            let border = 'rgba(255, 255, 255, 0.06)'
            let textColor = 'var(--text-muted)'

            if (isCompleted) {
              icon = '✓'
              bg = 'rgba(16, 185, 129, 0.2)'
              border = '#10b981'
              textColor = '#10b981'
            } else if (isBadminton) {
              icon = '🏸'
            } else if (isFastDay) {
              icon = '🧘'
            }

            return (
              <div
                key={shortName}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.2rem',
                  padding: '0.4rem 0.2rem',
                  borderRadius: '0.5rem',
                  backgroundColor: isToday ? 'rgba(59, 130, 246, 0.15)' : bg,
                  border: `1px solid ${isToday ? 'var(--primary-color)' : border}`,
                }}
              >
                <span style={{ fontSize: '0.7rem', color: isToday ? '#60a5fa' : 'var(--text-muted)', fontWeight: isToday ? 700 : 500 }}>
                  {shortName}
                </span>
                <span style={{ fontSize: '0.8rem', color: textColor, fontWeight: 700 }}>
                  {icon}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* 5. Workout AI Modal */}
      {showWorkoutAiModal && onSynthesizeWorkoutRecommendation && (
        <WorkoutAiModal
          currentCitation={workoutRecommendation?.research_citation}
          onClose={() => setShowWorkoutAiModal(false)}
          onSynthesize={onSynthesizeWorkoutRecommendation}
        />
      )}
    </div>
  )
}
