import { useState } from 'react'
import { Button, EmptyState, GlassCard, NumericKeypadModal } from '@yggdrasil-lab/ui'
import type { Exercise, SessionPayload } from '../types'
import { isPerHandExercise } from '../utils/session'

interface ActiveKeypadTarget {
  itemIndex: number
  setIndex: number
  field: 'weight_kg' | 'reps'
  label: string
}

interface ActiveWorkoutViewProps {
  session: SessionPayload
  exercises: Exercise[]
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

/**
 * Active workout logging screen with per-set weight/rep inputs and tactile keypad modal.
 */
export function ActiveWorkoutView({
  session,
  exercises,
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

  const openKeypadForSet = (
    itemIndex: number,
    setIndex: number,
    field: 'weight_kg' | 'reps',
    label: string,
    currentVal: number | null
  ) => {
    setKeypadTarget({ itemIndex, setIndex, field, label })
    setKeypadBuffer(currentVal !== null ? String(currentVal) : '')
  }

  const confirmKeypadValue = () => {
    if (!keypadTarget) return
    const parsed =
      keypadTarget.field === 'weight_kg'
        ? parseFloat(keypadBuffer)
        : parseInt(keypadBuffer, 10)
    onUpdateSet(
      keypadTarget.itemIndex,
      keypadTarget.setIndex,
      keypadTarget.field,
      !isNaN(parsed) ? parsed : null
    )
    setKeypadTarget(null)
  }

  return (
    <>
      <section className="animate-slide-up">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-xl font-bold m-0 text-slate-100">
              {(session.extra?.routine_name as string) || 'Current Workout'}
            </h2>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 mt-1">
              In progress
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onDiscard}>
            Discard
          </Button>
        </div>

        <GlassCard>
          {session.items.length === 0 ? (
            <EmptyState
              variant="dashed"
              title="No exercises added yet."
              description="Tap + Add Exercise below to stage movements for this session."
            />
          ) : (
            <div className="space-y-4">
              {session.items.map((item, itemIdx) => {
                const exercise = exercises.find((e) => e.id === item.exercise_id)
                const exLabel =
                  (item.extra?.custom_name as string) || exercise?.name || 'Unknown Exercise'
                const isPerHand = isPerHandExercise(exercise, item.extra?.weight_basis, exLabel)
                const targetReps = (item.extra?.target_reps as number | null) ?? null
                const targetWeight = (item.extra?.target_weight_kg as number | null) ?? null

                return (
                  <div key={item.id} className="workout-item">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-bold text-slate-100 m-0">{exLabel}</h3>
                        {isPerHand && (
                          <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold bg-purple-500/15 text-purple-300">
                            per hand
                          </span>
                        )}
                      </div>
                      <Button
                        variant="danger"
                        size="xs"
                        onClick={() => onRemoveExercise(item.id)}
                        title="Remove Exercise"
                      >
                        ✕
                      </Button>
                    </div>

                    <div className="flex flex-col gap-2.5">
                      {item.sets.length > 0 && (
                        <div className="set-row text-slate-400 text-xs pb-1">
                          <div className="text-center">SET</div>
                          <div className="text-center">{isPerHand ? 'KG / HAND' : 'KG'}</div>
                          <div className="text-center">REPS</div>
                          <div />
                        </div>
                      )}

                      {item.sets.map((set, setIdx) => (
                        <div key={set.id} className="set-row">
                          <div className="set-number">{set.set_number}</div>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder={
                              targetWeight !== null
                                ? isPerHand
                                  ? `${targetWeight} per hand`
                                  : String(targetWeight)
                                : isPerHand
                                ? 'Weight (per hand)'
                                : 'Weight'
                            }
                            value={set.weight_kg !== null ? set.weight_kg : ''}
                            onChange={(e) =>
                              onUpdateSet(
                                itemIdx,
                                setIdx,
                                'weight_kg',
                                e.target.value ? parseFloat(e.target.value) : null
                              )
                            }
                            onDoubleClick={() =>
                              openKeypadForSet(
                                itemIdx,
                                setIdx,
                                'weight_kg',
                                `${exLabel} - Set ${set.set_number} Weight`,
                                set.weight_kg
                              )
                            }
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder={targetReps !== null ? String(targetReps) : 'Reps'}
                            value={set.reps !== null ? set.reps : ''}
                            onChange={(e) =>
                              onUpdateSet(
                                itemIdx,
                                setIdx,
                                'reps',
                                e.target.value ? parseInt(e.target.value, 10) : null
                              )
                            }
                            onDoubleClick={() =>
                              openKeypadForSet(
                                itemIdx,
                                setIdx,
                                'reps',
                                `${exLabel} - Set ${set.set_number} Reps`,
                                set.reps
                              )
                            }
                          />
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => onRemoveSet(itemIdx, setIdx)}
                            title="Remove Set"
                          >
                            🗑
                          </Button>
                        </div>
                      ))}
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      className="mt-3"
                      onClick={() => onAddSet(itemIdx)}
                    >
                      + Add Set
                    </Button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex flex-col gap-3 mt-4 pt-3 border-t border-border">
            <Button variant="secondary" size="lg" fullWidth onClick={onOpenExercisePicker}>
              + Add Exercise
            </Button>
            <Button variant="blue" size="lg" fullWidth onClick={onFinishWorkout}>
              Finish Workout
            </Button>
          </div>
        </GlassCard>
      </section>

      <NumericKeypadModal
        isOpen={keypadTarget !== null}
        onClose={() => setKeypadTarget(null)}
        title={keypadTarget?.label || 'Enter Set Metric'}
        displayLabel={keypadTarget?.field === 'weight_kg' ? 'Weight' : 'Reps'}
        value={keypadBuffer}
        displayValue={keypadBuffer || '0'}
        unit={keypadTarget?.field === 'weight_kg' ? 'KG' : 'REPS'}
        onChange={setKeypadBuffer}
        onSubmit={confirmKeypadValue}
        submitLabel="Apply Set Value"
        allowDecimals={keypadTarget?.field === 'weight_kg'}
        maxDecimalPlaces={1}
        variant="blue"
      />
    </>
  )
}
