import { useState } from 'react'
import {
  AlertBanner,
  AppHeader,
  AppShell,
  Button,
  PwaUpdateBanner,
  SessionExpiredBanner,
  StatusBadge,
} from '@yggdrasil-lab/ui'
import { ActiveWorkoutView } from './components/ActiveWorkoutView'
import { BottomNav } from './components/BottomNav'
import { EditSessionModal } from './components/EditSessionModal'
import { EffortDebriefModal } from './components/EffortDebriefModal'
import { ExercisePickerModal } from './components/ExercisePickerModal'
import { ProgressView } from './components/ProgressView'
import { TodayView } from './components/TodayView'
import { useKratosData } from './hooks/useKratosData'
import { useWorkoutSession } from './hooks/useWorkoutSession'
import type { ActiveTab, EffortRating, SessionPayload } from './types'
import { usePwaUpdate } from './utils/pwa'

/**
 * Root Kratos shell coordinating sync state, PWA updates, active workout logging,
 * post-workout debriefs, and Today / Progress tab views.
 */
export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today')
  const [showExercisePicker, setShowExercisePicker] = useState<boolean>(false)
  const [showDebriefModal, setShowDebriefModal] = useState<boolean>(false)
  const [editingSession, setEditingSession] = useState<SessionPayload | null>(null)

  const { needRefresh, applyUpdate, dismissUpdate } = usePwaUpdate()

  const {
    status,
    sessionExpired,
    queued,
    exercises,
    routines,
    sessions,
    biometrics,
    fastingRecommendation,
    workoutRecommendation,
    isGeneratingFasting,
    isGeneratingWorkout,
    fastingLogs,
    circadianDate,
    dayOfWeek,
    todayFastingCheckIn,
    sync,
    refreshAll,
    persistSession,
    deleteSession,
    confirmSession,
    updateSessionRecord,
    saveFastingCheckIn,
    synthesizeFastingRecommendation,
    synthesizeWorkoutRecommendation,
  } = useKratosData()

  const {
    session,
    updateSession,
    startSession,
    addExercise,
    removeExercise,
    addSet,
    updateSet,
    removeSet,
  } = useWorkoutSession({ exercises, workoutRecommendation })

  const handleStartRoutine = (routine?: Parameters<typeof startSession>[0]) => {
    startSession(routine)
    setActiveTab('today')
  }

  const handleSaveEdit = async (updatedSession: SessionPayload) => {
    await updateSessionRecord(updatedSession)
    setEditingSession(null)
  }

  const completeDebriefAndSave = async (
    effort: EffortRating,
    tags: string[],
    notes: string
  ) => {
    if (!session) return
    const ended_at = new Date().toISOString()
    const finalSession: SessionPayload = {
      ...session,
      ended_at,
      notes: notes || session.notes,
      extra: {
        ...(session.extra || {}),
        effort_rating: effort,
        effort_tags: tags,
      },
    }
    updateSession(null)
    setShowDebriefModal(false)
    setActiveTab('today')
    await persistSession(finalSession, { effort, tags, notes })
  }

  const skipDebriefAndSave = async () => {
    if (!session) return
    const finalSession: SessionPayload = { ...session, ended_at: new Date().toISOString() }
    updateSession(null)
    setShowDebriefModal(false)
    setActiveTab('today')
    await persistSession(finalSession)
  }

  const statusLabel =
    status.kind === 'busy'
      ? 'Syncing...'
      : status.kind === 'error'
      ? status.message ?? 'Offline - data saved locally'
      : queued === 0
      ? 'All synced'
      : `${queued} pending`

  const statusVariant =
    status.kind === 'busy'
      ? 'busy'
      : status.kind === 'error'
      ? 'error'
      : queued === 0
      ? 'success'
      : 'warning'

  return (
    <AppShell
      header={
        <AppHeader
          variant="blue"
          brandIcon={
            <img
              src="/favicon.svg"
              alt="Kratos"
              className="w-full h-full object-contain rounded-xl"
            />
          }
          brandColor="overflow-hidden p-0 border border-sky-500/30"
          title="Kratos"
          subtitle="Strength & Circadian"
          onRefresh={() => void refreshAll()}
          isRefreshing={status.kind === 'busy'}
          actions={
            <div className="flex items-center space-x-2">
              <StatusBadge
                label={statusLabel}
                variant={statusVariant}
                isPulsing={status.kind === 'busy'}
                className={`status-badge ${
                  status.kind === 'busy' ? 'syncing' : status.kind === 'error' ? 'error' : ''
                }`}
              />
              {queued > 0 && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={sync}
                  disabled={status.kind === 'busy'}
                >
                  Force Sync
                </Button>
              )}
            </div>
          }
        />
      }
      bottomNav={
        <BottomNav
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          hasActiveWorkout={session !== null}
        />
      }
    >
      <div className="mx-auto w-full pb-24" style={{ maxWidth: '42rem' }}>
        {sessionExpired && <SessionExpiredBanner className="mb-4" />}
        {status.kind === 'error' && status.message && !sessionExpired && (
          <AlertBanner variant="error" className="mb-4">
            {status.message}
          </AlertBanner>
        )}
        {needRefresh && (
          <PwaUpdateBanner
            onReload={applyUpdate}
            onDismiss={dismissUpdate}
            className="mb-4"
          />
        )}

        {session ? (
          <ActiveWorkoutView
            session={session}
            exercises={exercises}
            onDiscard={() => updateSession(null)}
            onRemoveExercise={removeExercise}
            onAddSet={addSet}
            onUpdateSet={updateSet}
            onRemoveSet={removeSet}
            onOpenExercisePicker={() => setShowExercisePicker(true)}
            onFinishWorkout={() => setShowDebriefModal(true)}
          />
        ) : activeTab === 'progress' || activeTab === 'history' ? (
          <ProgressView
            sessions={sessions}
            exercises={exercises}
            routines={routines}
            fastingLogs={fastingLogs}
            biometrics={biometrics}
            onDeleteSession={deleteSession}
            onConfirmSession={confirmSession}
            onEditSession={setEditingSession}
          />
        ) : (
          <TodayView
            circadianDate={circadianDate}
            dayOfWeek={dayOfWeek}
            biometrics={biometrics}
            fastingRecommendation={fastingRecommendation}
            workoutRecommendation={workoutRecommendation}
            routines={routines}
            exercises={exercises}
            sessions={sessions}
            latestFastingCheckIn={todayFastingCheckIn}
            onStartRoutine={handleStartRoutine}
            onSaveFastingCheckIn={saveFastingCheckIn}
            onSynthesizeFastingRecommendation={synthesizeFastingRecommendation}
            onSynthesizeWorkoutRecommendation={synthesizeWorkoutRecommendation}
            onDeleteSession={deleteSession}
            onConfirmSession={confirmSession}
            onEditSession={setEditingSession}
            isGeneratingWorkout={isGeneratingWorkout}
            isGeneratingFasting={isGeneratingFasting}
          />
        )}
      </div>

      {showDebriefModal && session && (
        <EffortDebriefModal
          session={session}
          exercises={exercises}
          onSave={completeDebriefAndSave}
          onSkip={skipDebriefAndSave}
        />
      )}

      {editingSession && (
        <EditSessionModal
          session={editingSession}
          routines={routines}
          sessions={sessions}
          isOpen={editingSession !== null}
          onClose={() => setEditingSession(null)}
          onSave={handleSaveEdit}
        />
      )}

      <ExercisePickerModal
        isOpen={showExercisePicker}
        exercises={exercises}
        hasError={status.kind === 'error'}
        onClose={() => setShowExercisePicker(false)}
        onSelectExercise={addExercise}
      />
    </AppShell>
  )
}
