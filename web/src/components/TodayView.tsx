import type {
  DailyBiometrics,
  Exercise,
  Routine,
  SessionPayload,
  WorkoutRecommendation,
} from '../types'
import { DAY_NAMES, formatFriendlyDate } from '../utils/circadian'
import { computeWeeklyRhythm } from '../utils/sessionMetrics'
import { InferredWorkoutBanner } from './InferredWorkoutBanner'
import { ReadinessVitalsCard } from './ReadinessVitalsCard'
import { TodayTrainingCard } from './TodayTrainingCard'
import { WeeklyRhythmBar } from './WeeklyRhythmBar'

interface TodayViewProps {
  circadianDate: string
  dayOfWeek: number
  biometrics: DailyBiometrics | null
  workoutRecommendation?: WorkoutRecommendation | null
  routines: Routine[]
  exercises: Exercise[]
  sessions: SessionPayload[]
  onStartRoutine: (routine?: Routine) => void
  onSynthesizeWorkoutRecommendation?: (customContext?: string) => Promise<void>
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession?: (session: SessionPayload) => void
  onSplitSession?: (session: SessionPayload) => void
  isGeneratingWorkout?: boolean
}

/**
 * Today dashboard composing daily readiness, training prescription,
 * inferred workout reviews, and Monday-Sunday weekly adherence.
 */
export function TodayView({
  circadianDate,
  dayOfWeek,
  biometrics,
  workoutRecommendation,
  routines,
  exercises,
  sessions,
  onStartRoutine,
  onSynthesizeWorkoutRecommendation,
  onDeleteSession,
  onConfirmSession,
  onEditSession,
  onSplitSession,
  isGeneratingWorkout,
}: TodayViewProps) {
  const inferredSessions = sessions.filter((s) => Boolean(s.extra?.inferred))
  const weekDaySessions = computeWeeklyRhythm(sessions, dayOfWeek)

  return (
    <div className="animate-fade-in pb-4">
      <div className="mb-4">
        <div className="text-xs text-slate-400 uppercase tracking-wider">
          {DAY_NAMES[dayOfWeek]} • Auckland
        </div>
        <h2 className="text-2xl font-bold m-0 mt-0.5 text-slate-100">
          {formatFriendlyDate(circadianDate)}
        </h2>
      </div>

      <InferredWorkoutBanner
        inferredSessions={inferredSessions}
        routines={routines}
        circadianDate={circadianDate}
        onConfirmSession={onConfirmSession}
        onDeleteSession={onDeleteSession}
        onEditSession={onEditSession}
        onSplitSession={onSplitSession}
      />

      <ReadinessVitalsCard biometrics={biometrics} />

      <TodayTrainingCard
        circadianDate={circadianDate}
        workoutRecommendation={workoutRecommendation}
        routines={routines}
        exercises={exercises}
        sessions={sessions}
        isGeneratingWorkout={isGeneratingWorkout}
        onStartRoutine={onStartRoutine}
        onSynthesizeWorkoutRecommendation={onSynthesizeWorkoutRecommendation}
      />

      <WeeklyRhythmBar dayOfWeek={dayOfWeek} weekDaySessions={weekDaySessions} />
    </div>
  )
}
