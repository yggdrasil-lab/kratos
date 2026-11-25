import { useState } from 'react'
import { Button, ChipSelector, FormField, Modal, OptionCardGroup, TextInput } from '@yggdrasil-lab/ui'
import type { OptionCardItem } from '@yggdrasil-lab/ui'
import type { EffortRating, Exercise, SessionPayload } from '../types'
import { computeSessionVolumeAndSets } from '../utils/session'

interface EffortDebriefModalProps {
  session: SessionPayload
  exercises: Exercise[]
  onSave: (effort: EffortRating, tags: string[], notes: string) => void
  onSkip: () => void
}

const EFFORT_OPTIONS: OptionCardItem<EffortRating>[] = [
  {
    value: 'too_easy',
    icon: '🟢',
    label: 'Too Easy',
    description: 'Plenty left in the tank. Ready for weight bump next time.',
    accent: 'emerald',
  },
  {
    value: 'optimal',
    icon: '🟡',
    label: 'Just Right / Optimal',
    description: 'Hit true technical failure on target sets. Solid fatigue.',
    accent: 'amber',
  },
  {
    value: 'hard',
    icon: '🟠',
    label: 'Challenging / Hard',
    description: 'Pushed to the limits. Will need recovery before next session.',
    accent: 'orange',
  },
  {
    value: 'too_hard',
    icon: '🔴',
    label: 'Too Hard / Cooked',
    description: 'Missed target reps, form breakdown, or joints felt uncomfortable.',
    accent: 'rose',
  },
]

const QUICK_TAGS = [
  '💪 Felt Strong',
  '⚡ Great Pump',
  '🎯 New PR Hit',
  '🦴 Joint Stiff',
  '🥱 Low Energy',
  '⏱️ Rushed Workout',
]

export function EffortDebriefModal({ session, exercises, onSave, onSkip }: EffortDebriefModalProps) {
  const initialRating =
    typeof session.extra?.effort_rating === 'string'
      ? (session.extra.effort_rating as EffortRating)
      : 'optimal'
  const initialTags = Array.isArray(session.extra?.effort_tags)
    ? (session.extra.effort_tags as string[])
    : []
  const [selectedRating, setSelectedRating] = useState<EffortRating>(initialRating)
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags)
  const [notes, setNotes] = useState<string>(session.notes || '')

  const { volume: totalVolumeKg, sets: completedSetsCount } = computeSessionVolumeAndSets(session, exercises)

  const startTime = new Date(session.started_at).getTime()
  const endTime = session.ended_at ? new Date(session.ended_at).getTime() : Date.now()
  const durationMinutes = Math.max(1, Math.round((endTime - startTime) / 60000))

  const handleComplete = () => {
    onSave(selectedRating, selectedTags, notes.trim())
  }

  return (
    <Modal
      isOpen={true}
      onClose={onSkip}
      title="Workout Complete!"
      headerIcon="🎉"
      subtitle={`${durationMinutes} min • ${Math.round(totalVolumeKg).toLocaleString()} kg volume • ${completedSetsCount} sets finished`}
      footer={
        <div className="flex gap-2.5 justify-end">
          <Button variant="secondary" size="md" onClick={onSkip}>
            Skip
          </Button>
          <Button variant="blue" size="md" onClick={handleComplete}>
            Save and Finish
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <OptionCardGroup
          label="How much effort did this take?"
          options={EFFORT_OPTIONS}
          value={selectedRating}
          onChange={setSelectedRating}
        />

        <FormField label="Quick reflections (optional):">
          <ChipSelector
            options={QUICK_TAGS}
            multiSelect
            selectedValues={selectedTags}
            onChangeValues={setSelectedTags}
            variant="purple"
          />
        </FormField>

        <FormField label="Notes (optional)" htmlFor="effort-debrief-notes">
          <TextInput
            id="effort-debrief-notes"
            type="text"
            variant="blue"
            placeholder="Add note (e.g. form felt smooth, or tight hamstring)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </FormField>
      </div>
    </Modal>
  )
}
