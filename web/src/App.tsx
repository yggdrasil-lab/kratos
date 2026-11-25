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
import { SplitSessionModal } from './components/SplitSessionModal'
import { TodayView } from './components/TodayView'
import { useKratosData, type SyncStatus } from './hooks/useKratosData'
import { useWorkoutSession } from './hooks/useWorkoutSession'
import type {
  ActiveTab,
  EffortRating,
  Exercise,
  Routine,
  SessionPayload,
  SplitSegmentInput,
  WorkoutRecommendation,
} from './types'
import { usePwaUpdate } from './utils/pwa'

function resolveHeaderStatus(status: SyncStatus, queued: number) {
  const label =
    status.kind === 'busy'
      ? 'Syncing...'
      : status.kind === 'error'
      ? status.message ?? 'Offline - data saved locally'
      : queued === 0
      ? 'All synced'
      : `${queued} pending`

  const variant: 'busy' | 'error' | 'success' | 'warning' =
    status.kind === 'busy' ? 'busy' : status.kind === 'error' ? 'error' : queued === 0 ? 'success' : 'warning'
  return { label, variant }
}

function KratosAppHeader({ status, queued, onRefresh }: { status: SyncStatus; queued: number; onRefresh: () => void }) {
  const { label, variant } = resolveHeaderStatus(status, queued)
  return (
    <AppHeader
      variant="brand"
      brandIcon={<img src="/favicon.svg" alt="Kratos" className="w-full h-full object-contain rounded-xl" />}
      brandColor="overflow-hidden p-0 border border-accent/30"
      title="Kratos"
      subtitle="Strength & Circadian"
      onRefresh={onRefresh}
      isRefreshing={status.kind === 'busy'}
      actions={
        <div className="flex items-center space-x-2">
          <StatusBadge
            label={label}
            variant={variant}
            isPulsing={status.kind === 'busy'}
            className={`status-badge ${status.kind === 'busy' ? 'syncing' : status.kind === 'error' ? 'error' : ''}`}
          />
          {queued > 0 && (
            <Button variant="secondary" size="xs" onClick={onRefresh} disabled={status.kind === 'busy'}>
              Force Sync
            </Button>
          )}
        </div>
      }
    />
  )
}

interface KratosModalsProps {
  session: SessionPayload | null
  exercises: Exercise[]
  routines: Routine[]
  sessions: SessionPayload[]
  workoutRecommendation: WorkoutRecommendation | null
  showDebriefModal: boolean
  showExercisePicker: boolean
  editingSession: SessionPayload | null
  splittingSession: SessionPayload | null
  hasError: boolean
  onCompleteDebrief: (effort: EffortRating, tags: string[], notes: string) => void
  onSkipDebrief: () => void
  onCloseEdit: () => void
  onSaveEdit: (updated: SessionPayload) => Promise<void>
  onCloseSplit: () => void
  onSaveSplit: (parentId: string, segments: SplitSegmentInput[]) => Promise<void>
  onSplitAndLogSets: (parentId: string, segments: SplitSegmentInput[]) => Promise<void>
  onClosePicker: () => void
  onSelectExercise: (ex: Exercise) => void
}

function KratosModals(p: KratosModalsProps) {
  return (
    <>
      {p.showDebriefModal && p.session && (
        <EffortDebriefModal session={p.session} exercises={p.exercises} onSave={p.onCompleteDebrief} onSkip={p.onSkipDebrief} />
      )}
      {p.editingSession && (
        <EditSessionModal
          session={p.editingSession}
          routines={p.routines}
          sessions={p.sessions}
          isOpen={p.editingSession !== null}
          onClose={p.onCloseEdit}
          onSave={p.onSaveEdit}
        />
      )}
      {p.splittingSession && (
        <SplitSessionModal
          session={p.splittingSession}
          routines={p.routines}
          workoutRecommendation={p.workoutRecommendation}
          isOpen={p.splittingSession !== null}
          onClose={p.onCloseSplit}
          onSaveSplit={p.onSaveSplit}
          onSplitAndLogSets={p.onSplitAndLogSets}
        />
      )}
      <ExercisePickerModal
        isOpen={p.showExercisePicker}
        exercises={p.exercises}
        hasError={p.hasError}
        onClose={p.onClosePicker}
        onSelectExercise={p.onSelectExercise}
      />
    </>
  )
}

function AppMainRouter({
  activeTab,
  data,
  workout,
  onOpenPicker,
  onFinishWorkout,
  onStartRoutine,
  onEditSession,
  onSplitSession,
  onLogSets,
}: {
  activeTab: ActiveTab
  data: ReturnType<typeof useKratosData>
  workout: ReturnType<typeof useWorkoutSession>
  onOpenPicker: () => void
  onFinishWorkout: () => void
  onStartRoutine: (routine?: Routine) => void
  onEditSession: (s: SessionPayload) => void
  onSplitSession: (s: SessionPayload) => void
  onLogSets: (s: SessionPayload) => void
}) {
  if (workout.session) {
    return (
      <ActiveWorkoutView
        session={workout.session}
        exercises={data.exercises}
        isRetroactive={workout.isRetroactive}
        onDiscard={() => workout.updateSession(null)}
        onRemoveExercise={workout.removeExercise}
        onAddSet={workout.addSet}
        onUpdateSet={workout.updateSet}
        onRemoveSet={workout.removeSet}
        onOpenExercisePicker={onOpenPicker}
        onFinishWorkout={onFinishWorkout}
      />
    )
  }
  if (activeTab === 'progress' || activeTab === 'history') {
    return (
      <ProgressView
        sessions={data.sessions}
        exercises={data.exercises}
        routines={data.routines}
        fastingLogs={data.fastingLogs}
        biometrics={data.biometrics}
        onDeleteSession={data.deleteSession}
        onConfirmSession={data.confirmSession}
        onEditSession={onEditSession}
        onSplitSession={onSplitSession}
        onLogSets={onLogSets}
      />
    )
  }
  return (
    <TodayView
      circadianDate={data.circadianDate}
      dayOfWeek={data.dayOfWeek}
      biometrics={data.biometrics}
      fastingRecommendation={data.fastingRecommendation}
      workoutRecommendation={data.workoutRecommendation}
      routines={data.routines}
      exercises={data.exercises}
      sessions={data.sessions}
      latestFastingCheckIn={data.todayFastingCheckIn}
      onStartRoutine={onStartRoutine}
      onSaveFastingCheckIn={data.saveFastingCheckIn}
      onSynthesizeFastingRecommendation={data.synthesizeFastingRecommendation}
      onSynthesizeWorkoutRecommendation={data.synthesizeWorkoutRecommendation}
      onDeleteSession={data.deleteSession}
      onConfirmSession={data.confirmSession}
      onEditSession={onEditSession}
      onSplitSession={onSplitSession}
      isGeneratingWorkout={data.isGeneratingWorkout}
      isGeneratingFasting={data.isGeneratingFasting}
    />
  )
}

function useDebriefAndSave(
  workout: ReturnType<typeof useWorkoutSession>,
  persistSession: ReturnType<typeof useKratosData>['persistSession'],
  setShowDebriefModal: (v: boolean) => void,
  setActiveTab: (t: ActiveTab) => void
) {
  const finishWorkout = async () => {
    if (!workout.session) return
    if (workout.isRetroactive) {
      const finalSession: SessionPayload = {
        ...workout.session,
        extra: { ...(workout.session.extra || {}), inferred: false, confirmed: true },
      }
      workout.updateSession(null)
      await persistSession(finalSession)
      return
    }
    setShowDebriefModal(true)
  }

  const completeDebrief = async (effort: EffortRating, tags: string[], notes: string) => {
    if (!workout.session) return
    const ended_at =
      workout.isRetroactive && workout.session.ended_at ? workout.session.ended_at : new Date().toISOString()
    const finalSession: SessionPayload = {
      ...workout.session,
      ended_at,
      notes: notes || workout.session.notes,
      extra: { ...(workout.session.extra || {}), effort_rating: effort, effort_tags: tags, inferred: false, confirmed: true },
    }
    workout.updateSession(null)
    setShowDebriefModal(false)
    setActiveTab('today')
    await persistSession(finalSession, { effort, tags, notes })
  }

  const skipDebrief = async () => {
    if (!workout.session) return
    const ended_at =
      workout.isRetroactive && workout.session.ended_at ? workout.session.ended_at : new Date().toISOString()
    const finalSession: SessionPayload = { ...workout.session, ended_at }
    workout.updateSession(null)
    setShowDebriefModal(false)
    setActiveTab('today')
    await persistSession(finalSession)
  }

  return { finishWorkout, completeDebrief, skipDebrief }
}

/**
 * Root Kratos shell coordinating sync state, PWA updates, active/retroactive workout logging,
 * session splitting, post-workout debriefs, and Today / Progress tab views.
 */
export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('today')
  const [showExercisePicker, setShowExercisePicker] = useState<boolean>(false)
  const [showDebriefModal, setShowDebriefModal] = useState<boolean>(false)
  const [editingSession, setEditingSession] = useState<SessionPayload | null>(null)
  const [splittingSession, setSplittingSession] = useState<SessionPayload | null>(null)
  const { needRefresh, applyUpdate, dismissUpdate } = usePwaUpdate()
  const data = useKratosData()
  const workout = useWorkoutSession({ exercises: data.exercises, workoutRecommendation: data.workoutRecommendation })
  const debrief = useDebriefAndSave(workout, data.persistSession, setShowDebriefModal, setActiveTab)

  const handleLogSetsForSession = (targetSession: SessionPayload) => {
    const matchedRoutine = targetSession.routine_id ? data.routines.find((r) => r.id === targetSession.routine_id) : undefined
    workout.editExistingSession(targetSession, matchedRoutine)
  }

  return (
    <AppShell
      header={<KratosAppHeader status={data.status} queued={data.queued} onRefresh={() => void data.refreshAll()} />}
      bottomNav={<BottomNav activeTab={activeTab} onChangeTab={setActiveTab} hasActiveWorkout={workout.session !== null} />}
    >
      <div className="mx-auto w-full pb-24" style={{ maxWidth: '42rem' }}>
        {data.sessionExpired && <SessionExpiredBanner className="mb-4" />}
        {data.status.kind === 'error' && Boolean(data.status.message) && !data.sessionExpired && (
          <AlertBanner variant="error" className="mb-4">{data.status.message}</AlertBanner>
        )}
        {needRefresh && <PwaUpdateBanner onReload={applyUpdate} onDismiss={dismissUpdate} className="mb-4" />}
        <AppMainRouter
          activeTab={activeTab}
          data={data}
          workout={workout}
          onOpenPicker={() => setShowExercisePicker(true)}
          onFinishWorkout={() => void debrief.finishWorkout()}
          onStartRoutine={(routine) => {
            workout.startSession(routine)
            setActiveTab('today')
          }}
          onEditSession={setEditingSession}
          onSplitSession={setSplittingSession}
          onLogSets={handleLogSetsForSession}
        />
      </div>

      <KratosModals
        session={workout.session}
        exercises={data.exercises}
        routines={data.routines}
        sessions={data.sessions}
        workoutRecommendation={data.workoutRecommendation}
        showDebriefModal={showDebriefModal}
        showExercisePicker={showExercisePicker}
        editingSession={editingSession}
        splittingSession={splittingSession}
        hasError={data.status.kind === 'error'}
        onCompleteDebrief={(e, t, n) => void debrief.completeDebrief(e, t, n)}
        onSkipDebrief={() => void debrief.skipDebrief()}
        onCloseEdit={() => setEditingSession(null)}
        onSaveEdit={async (updated) => {
          await data.updateSessionRecord(updated)
          setEditingSession(null)
        }}
        onCloseSplit={() => setSplittingSession(null)}
        onSaveSplit={async (parentId, segments) => {
          await data.splitSessionRecord(parentId, segments)
        }}
        onSplitAndLogSets={async (parentId, segments) => {
          const created = await data.splitSessionRecord(parentId, segments)
          const routineChild = created.find((item) => Boolean(item.routine_id))
          if (routineChild) handleLogSetsForSession(routineChild)
        }}
        onClosePicker={() => setShowExercisePicker(false)}
        onSelectExercise={workout.addExercise}
      />
    </AppShell>
  )
}
