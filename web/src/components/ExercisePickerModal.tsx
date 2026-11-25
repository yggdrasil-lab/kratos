import { useMemo, useState } from 'react'
import { EmptyState, Modal, SearchInput, SelectableCard } from '@yggdrasil-lab/ui'
import type { Exercise } from '../types'

interface ExercisePickerModalProps {
  isOpen: boolean
  exercises: Exercise[]
  hasError: boolean
  onClose: () => void
  onSelectExercise: (exercise: Exercise) => void
}

/**
 * Searchable catalogue modal for appending exercises to an active workout session.
 */
export function ExercisePickerModal({
  isOpen,
  exercises,
  hasError,
  onClose,
  onSelectExercise,
}: ExercisePickerModalProps) {
  const [search, setSearch] = useState<string>('')

  const filteredExercises = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return exercises
    return exercises.filter((e) => e.name.toLowerCase().includes(query))
  }, [exercises, search])

  const handleClose = () => {
    setSearch('')
    onClose()
  }

  const handleSelect = (exercise: Exercise) => {
    onSelectExercise(exercise)
    setSearch('')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Select Exercise">
      <div className="space-y-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search exercises..."
          variant="blue"
        />

        {exercises.length === 0 ? (
          <EmptyState
            variant="dashed"
            title={hasError ? 'Unable to load exercises' : 'No exercises found'}
            description={
              hasError
                ? "Couldn't load exercises - check your connection and try again."
                : 'Add some exercises to the database first.'
            }
          />
        ) : filteredExercises.length === 0 ? (
          <EmptyState
            variant="dashed"
            title="No exercises match your search"
            description="Try a different muscle group or movement name."
          />
        ) : (
          <ul className="exercise-list">
            {filteredExercises.map((exercise) => (
              <li key={exercise.id}>
                <SelectableCard
                  className="exercise-item"
                  title={exercise.name}
                  subtitle={exercise.primary_muscles.join(', ')}
                  badge={<span className="text-sky-400 font-bold text-lg">+</span>}
                  variant="blue"
                  onClick={() => handleSelect(exercise)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
