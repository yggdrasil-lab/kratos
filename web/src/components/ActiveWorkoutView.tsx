import { useState } from 'react'
import {
  Button,
  EmptyState,
  GlassCard,
  NumericKeypadModal,
  RestTimerBar,
  useRestTimer,
} from '@yggdrasil-lab/ui'
import type { Exercise, SessionItemPayload, SessionPayload, SetEntry } from '../types'
import { isPerHandExercise } from '../utils/session'
import { formatTimeRangeLabel } from '../utils/splitSession'

interface ActiveKeypadTarget {
  itemIndex: number
  setIndex: number
  field: 'weight_kg' | 'reps'
  label: string
}

interface ActiveWorkoutViewProps {
  session: SessionPayload
  exercises: Exercise[]
  isRetroactive?: boolean
  onDiscard: () => void
  onRemoveExercise: (itemId: string) => void
  onAddSet: (itemIndex: number) => void
  onUpdateSet: (
    itemIndex: number,
    setIndex: number,
    field: 'weight_kg' | 'reps',
    value: number | null
  ) => void
  onRemoveSet: (itemIndex: number, setIndex: number) => void
  onOpenExercisePicker: () => void
  onFinishWorkout: () => void
}

function SetInputRow({
  set,
  itemIdx,
  setIdx,
  exLabel,
  isPerHand,
  targetWeight,
  targetReps,
  onUpdateSet,
  onRepsChange,
  onRemoveSet,
  onOpenKeypad,
}: {
  set: SetEntry
  itemIdx: number
  setIdx: number
  exLabel: string
  isPerHand: boolean
  targetWeight: number | null
  targetReps: string | null
  onUpdateSet: ActiveWorkoutViewProps['onUpdateSet']
  onRepsChange: (itemIndex: number, setIndex: number, prevReps: number | null, raw: string) => void
  onRemoveSet: (itemIndex: number, setIndex: number) => void
  onOpenKeypad: (
    itemIndex: number,
    setIndex: number,
    field: 'weight_kg' | 'reps',
    label: string,
    currentVal: number | null
  ) => void
}) {
  return (
    <div className="set-row">
      <div className="set-number">{set.set_number}</div>
      <input
        type="text"
        inputMode="decimal"
        placeholder={targetWeight !== null ? String(targetWeight) : isPerHand ? 'Weight (per hand)' : 'Weight'}
        value={set.weight_kg !== null ? set.weight_kg : ''}
        onChange={(e) =>
          onUpdateSet(itemIdx, setIdx, 'weight_kg', e.target.value ? parseFloat(e.target.value) : null)
        }
        onDoubleClick={() =>
          onOpenKeypad(itemIdx, setIdx, 'weight_kg', `${exLabel} - Set ${set.set_number} Weight`, set.weight_kg)
        }
      />
      <input
        type="text"
        inputMode="numeric"
        placeholder={targetReps !== null ? targetReps : 'Reps'}
        value={set.reps !== null ? set.reps : ''}
        onChange={(e) => onRepsChange(itemIdx, setIdx, set.reps, e.target.value)}
        onDoubleClick={() =>
          onOpenKeypad(itemIdx, setIdx, 'reps', `${exLabel} - Set ${set.set_number} Reps`, set.reps)
        }
      />
      <Button variant="secondary" size="xs" onClick={() => onRemoveSet(itemIdx, setIdx)} title="Remove Set">
        🗑
      </Button>
    </div>
  )
}

function ExerciseItemHeader({
  exLabel,
  isPerHand,
  onRemove,
}: {
  exLabel: string
  isPerHand: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-lg font-bold text-slate-100 m-0">{exLabel}</h3>
        {isPerHand && (
          <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold bg-purple-500/15 text-purple-300">
            per hand
          </span>
        )}
      </div>
      <Button variant="danger" size="xs" onClick={onRemove} title="Remove Exercise">
        ✕
      </Button>
    </div>
  )
}

function WorkoutExerciseItem({
  item,
  itemIdx,
  exercises,
  onRemoveExercise,
  onUpdateSet,
  onRepsChange,
  onAddSet,
  onRemoveSet,
  onOpenKeypad,
}: {
  item: SessionItemPayload
  itemIdx: number
  exercises: Exercise[]
  onRemoveExercise: (itemId: string) => void
  onUpdateSet: ActiveWorkoutViewProps['onUpdateSet']
  onRepsChange: (itemIndex: number, setIndex: number, prevReps: number | null, raw: string) => void
  onAddSet: (itemIndex: number) => void
  onRemoveSet: (itemIndex: number, setIndex: number) => void
  onOpenKeypad: (
    itemIndex: number,
    setIndex: number,
    field: 'weight_kg' | 'reps',
    label: string,
    currentVal: number | null
  ) => void
}) {
  const exercise = exercises.find((e) => e.id === item.exercise_id)
  const exLabel =
    (typeof item.extra?.custom_name === 'string' && item.extra.custom_name) ||
    exercise?.name ||
    'Unknown Exercise'
  const isPerHand = isPerHandExercise(exercise, item.extra?.weight_basis, exLabel)
  const targetReps =
    item.extra?.target_reps !== undefined && item.extra?.target_reps !== null
      ? String(item.extra.target_reps)
      : null
  const targetWeight =
    typeof item.extra?.target_weight_kg === 'number' ? item.extra.target_weight_kg : null

  return (
    <div className="workout-item">
      <ExerciseItemHeader
        exLabel={exLabel}
        isPerHand={isPerHand}
        onRemove={() => onRemoveExercise(item.id)}
      />
      <div className="flex flex-col gap-2">
        {item.sets.length > 0 && (
          <div className="set-row text-slate-400 text-xs" style={{ paddingBottom: '0.5rem' }}>
            <div className="text-center">SET</div>
            <div className="text-center">{isPerHand ? 'KG / HAND' : 'KG'}</div>
            <div className="text-center">REPS</div>
            <div />
          </div>
        )}
        {item.sets.map((set, setIdx) => (
          <SetInputRow
            key={set.id}
            set={set}
            itemIdx={itemIdx}
            setIdx={setIdx}
            exLabel={exLabel}
            isPerHand={isPerHand}
            targetWeight={targetWeight}
            targetReps={targetReps}
            onUpdateSet={onUpdateSet}
            onRepsChange={onRepsChange}
            onRemoveSet={onRemoveSet}
            onOpenKeypad={onOpenKeypad}
          />
        ))}
      </div>
      <Button variant="secondary" size="sm" fullWidth className="mt-3" onClick={() => onAddSet(itemIdx)}>
        + Add Set
      </Button>
    </div>
  )
}

function ActiveWorkoutHeader({
  session,
  isRetroactive,
  onDiscard,
}: {
  session: SessionPayload
  isRetroactive: boolean
  onDiscard: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-4">
      <div>
        <h2 className="text-xl font-bold m-0 text-slate-100">
          {(session.extra?.routine_name as string) || 'Current Workout'}
        </h2>
        {isRetroactive ? (
          <span
            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 mt-1"
            data-testid="retroactive-log-badge"
          >
            Retroactive Log - {formatTimeRangeLabel(session.started_at, session.ended_at)}
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 mt-1">
            In progress
          </span>
        )}
      </div>
      <Button variant="secondary" size="sm" onClick={onDiscard}>
        {isRetroactive ? 'Cancel' : 'Discard'}
      </Button>
    </div>
  )
}

function ActiveWorkoutCard({
  session,
  exercises,
  isRetroactive,
  onRemoveExercise,
  onUpdateSet,
  onRepsChange,
  onAddSet,
  onRemoveSet,
  onOpenKeypad,
  onOpenExercisePicker,
  onFinishWorkout,
}: {
  session: SessionPayload
  exercises: Exercise[]
  isRetroactive: boolean
  onRemoveExercise: (itemId: string) => void
  onUpdateSet: ActiveWorkoutViewProps['onUpdateSet']
  onRepsChange: (itemIndex: number, setIndex: number, prevReps: number | null, raw: string) => void
  onAddSet: (itemIndex: number) => void
  onRemoveSet: (itemIndex: number, setIndex: number) => void
  onOpenKeypad: (
    itemIndex: number,
    setIndex: number,
    field: 'weight_kg' | 'reps',
    label: string,
    currentVal: number | null
  ) => void
  onOpenExercisePicker: () => void
  onFinishWorkout: () => void
}) {
  return (
    <GlassCard>
      {session.items.length === 0 ? (
        <EmptyState
          variant="dashed"
          title="No exercises added yet."
          description="Tap + Add Exercise below to stage movements for this session."
        />
      ) : (
        <div className="space-y-4">
          {session.items.map((item, itemIdx) => (
            <WorkoutExerciseItem
              key={item.id}
              item={item}
              itemIdx={itemIdx}
              exercises={exercises}
              onRemoveExercise={onRemoveExercise}
              onUpdateSet={onUpdateSet}
              onRepsChange={onRepsChange}
              onAddSet={onAddSet}
              onRemoveSet={onRemoveSet}
              onOpenKeypad={onOpenKeypad}
            />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-3 mt-4 pt-3 border-t border-border">
        <Button variant="secondary" size="lg" fullWidth onClick={onOpenExercisePicker}>
          + Add Exercise
        </Button>
        <Button variant="blue" size="lg" fullWidth onClick={onFinishWorkout}>
          {isRetroactive ? 'Save Sets' : 'Finish Workout'}
        </Button>
      </div>
    </GlassCard>
  )
}

function WorkoutKeypadModal({
  keypadTarget,
  keypadBuffer,
  onChangeBuffer,
  onClose,
  onConfirm,
}: {
  keypadTarget: ActiveKeypadTarget | null
  keypadBuffer: string
  onChangeBuffer: (v: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <NumericKeypadModal
      isOpen={keypadTarget !== null}
      onClose={onClose}
      title={keypadTarget?.label || 'Enter Set Metric'}
      displayLabel={keypadTarget?.field === 'weight_kg' ? 'Weight' : 'Reps'}
      value={keypadBuffer}
      displayValue={keypadBuffer || '0'}
      unit={keypadTarget?.field === 'weight_kg' ? 'KG' : 'REPS'}
      onChange={onChangeBuffer}
      onSubmit={onConfirm}
      submitLabel="Apply Set Value"
      allowDecimals={keypadTarget?.field === 'weight_kg'}
      maxDecimalPlaces={1}
      variant="blue"
    />
  )
}

/**
 * Active or retroactive workout logging screen with per-set weight/rep inputs,
 * rest timer bar (live mode only), and tactile keypad modal.
 */
export function ActiveWorkoutView({
  session,
  exercises,
  isRetroactive = false,
  onDiscard,
  onRemoveExercise,
  onAddSet,
  onUpdateSet,
  onRemoveSet,
  onOpenExercisePicker,
  onFinishWorkout,
}: ActiveWorkoutViewProps) {
  const [keypadTarget, setKeypadTarget] = useState<ActiveKeypadTarget | null>(null)
  const [keypadBuffer, setKeypadBuffer] = useState<string>('')
  const restTimer = useRestTimer(90)
  const startRestCountdown = () => !isRetroactive && restTimer.startTimer(restTimer.activePresetSeconds || 90)

  const confirmKeypadValue = () => {
    if (!keypadTarget) return
    const parsed = keypadTarget.field === 'weight_kg' ? parseFloat(keypadBuffer) : parseInt(keypadBuffer, 10)
    const nextValue = !isNaN(parsed) ? parsed : null
    onUpdateSet(keypadTarget.itemIndex, keypadTarget.setIndex, keypadTarget.field, nextValue)
    if (keypadTarget.field === 'reps' && nextValue !== null && nextValue > 0) startRestCountdown()
    setKeypadTarget(null)
  }

  const handleRepsChange = (itemIndex: number, setIndex: number, prevReps: number | null, raw: string) => {
    const parsed = raw ? parseInt(raw, 10) : null
    const nextReps = parsed !== null && !isNaN(parsed) ? parsed : null
    onUpdateSet(itemIndex, setIndex, 'reps', nextReps)
    if ((prevReps === null || prevReps <= 0) && nextReps !== null && nextReps > 0) startRestCountdown()
  }

  return (
    <>
      <section className="animate-slide-up kratos-active-workout-section">
        <ActiveWorkoutHeader session={session} isRetroactive={isRetroactive} onDiscard={onDiscard} />
        {!isRetroactive && (
          <RestTimerBar
            {...restTimer}
            onStart={restTimer.startTimer}
            onPause={restTimer.pauseTimer}
            onResume={restTimer.resumeTimer}
            onAdjust={restTimer.adjustTimer}
            onDismiss={restTimer.dismissTimer}
            variant="blue"
            className="mb-4"
          />
        )}
        <ActiveWorkoutCard
          session={session}
          exercises={exercises}
          isRetroactive={isRetroactive}
          onRemoveExercise={onRemoveExercise}
          onUpdateSet={onUpdateSet}
          onRepsChange={handleRepsChange}
          onAddSet={(idx) => { onAddSet(idx); startRestCountdown() }}
          onRemoveSet={onRemoveSet}
          onOpenKeypad={(idx, sIdx, field, label, val) => {
            setKeypadTarget({ itemIndex: idx, setIndex: sIdx, field, label })
            setKeypadBuffer(val !== null ? String(val) : '')
          }}
          onOpenExercisePicker={onOpenExercisePicker}
          onFinishWorkout={onFinishWorkout}
        />
      </section>
      <WorkoutKeypadModal
        keypadTarget={keypadTarget}
        keypadBuffer={keypadBuffer}
        onChangeBuffer={setKeypadBuffer}
        onClose={() => setKeypadTarget(null)}
        onConfirm={confirmKeypadValue}
      />
    </>
  )
}
