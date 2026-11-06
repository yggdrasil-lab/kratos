import { useState } from 'react'
import { Modal, OptionCardGroup, ChipSelector, Button } from '@yggdrasil-lab/ui'
import type { OptionCardItem } from '@yggdrasil-lab/ui'
import type { EffortRating, Exercise, SessionPayload } from '../types'

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

export function EffortDebriefModal({ session, exercises: _exercises, onSave, onSkip }: EffortDebriefModalProps) {
  const [selectedRating, setSelectedRating] = useState<EffortRating>('optimal')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [notes, setNotes] = useState<string>('')

  let totalVolumeKg = 0
  let completedSetsCount = 0

  session.items.forEach((item) => {
    item.sets.forEach((set) => {
      if (set.status === 'done') {
        completedSetsCount += 1
        const w = set.weight_kg ?? 0
        const r = set.reps ?? 0
        totalVolumeKg += w * r
      }
    })
  })

  const startTime = new Date(session.started_at).getTime()
  const durationMinutes = Math.max(1, Math.round((Date.now() - startTime) / 60000))

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
    >
      <div className="space-y-4">
        <OptionCardGroup
          label="How much effort did this take?"
          options={EFFORT_OPTIONS}
          value={selectedRating}
          onChange={setSelectedRating}
        />

        <div className="space-y-1.5">
          <label className="block font-semibold text-xs text-slate-300">
            Quick reflections (optional):
          </label>
          <ChipSelector
            options={QUICK_TAGS}
            multiSelect
            selectedValues={selectedTags}
            onChangeValues={setSelectedTags}
            variant="purple"
          />
        </div>

        <div>
          <input
            type="text"
            placeholder="Add note (e.g. form felt smooth, or tight hamstring)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-xs text-slate-100 placeholder-slate-500"
          />
        </div>

        <div className="flex gap-2.5 justify-end pt-1">
          <Button variant="secondary" size="md" onClick={onSkip}>
            Skip
          </Button>
          <Button variant="blue" size="md" onClick={handleComplete}>
            Save and Finish
          </Button>
        </div>
      </div>
    </Modal>
  )
}
