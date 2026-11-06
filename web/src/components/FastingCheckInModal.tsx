import { useState } from 'react'
import { Modal, OptionCardGroup, ChipSelector, Button } from '@yggdrasil-lab/ui'
import type { OptionCardItem } from '@yggdrasil-lab/ui'
import type { FastingCheckIn } from '../types'

interface FastingCheckInModalProps {
  date: string
  targetWindow: string
  initialCheckIn?: FastingCheckIn
  onSave: (checkIn: FastingCheckIn) => void
  onClose: () => void
}

type AdherenceValue = 'completed' | 'early' | 'off_plan'

const ADHERENCE_OPTIONS: OptionCardItem<AdherenceValue>[] = [
  {
    value: 'completed',
    icon: '🟢',
    label: 'Completed Target Window',
    description: 'Hit full fast target',
    accent: 'emerald',
  },
  {
    value: 'early',
    icon: '🟡',
    label: 'Broke Fast Early',
    description: 'Broke 1-2h before target window',
    accent: 'amber',
  },
  {
    value: 'off_plan',
    icon: '🔴',
    label: 'Off-Plan / Skipped Fast',
    description: 'Ate early breakfast or continuous grazing',
    accent: 'rose',
  },
]

const ENERGY_OPTIONS = [
  { value: 'high', label: '⚡ High' },
  { value: 'normal', label: '😐 Normal' },
  { value: 'low', label: '🪫 Low' },
]

const HEADACHE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'mild', label: 'Mild' },
  { value: 'sugar_spike', label: 'Sugar Spike' },
]

export function FastingCheckInModal({
  date,
  targetWindow,
  initialCheckIn,
  onSave,
  onClose,
}: FastingCheckInModalProps) {
  const [adherence, setAdherence] = useState<AdherenceValue>(
    initialCheckIn?.adherence ?? 'completed'
  )
  const [energy, setEnergy] = useState<'high' | 'normal' | 'low'>(
    initialCheckIn?.energy ?? 'normal'
  )
  const [headache, setHeadache] = useState<'none' | 'mild' | 'sugar_spike'>(
    initialCheckIn?.headache ?? 'none'
  )
  const [notes, setNotes] = useState<string>(initialCheckIn?.notes ?? '')

  const handleSave = () => {
    const payload: FastingCheckIn = {
      id: initialCheckIn?.id ?? crypto.randomUUID(),
      date,
      target_window: targetWindow,
      adherence,
      energy,
      headache,
      notes: notes.trim() || null,
      logged_at: new Date().toISOString(),
    }
    onSave(payload)
  }

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Fasting Check-In"
      subtitle={`Target: ${targetWindow} for ${date}`}
    >
      <div className="space-y-4">
        <OptionCardGroup
          label="Did you follow today's fasting window?"
          options={ADHERENCE_OPTIONS}
          value={adherence}
          onChange={setAdherence}
        />

        <div className="space-y-1.5">
          <label className="block font-semibold text-xs text-slate-300">
            Energy level during the fast:
          </label>
          <ChipSelector
            options={ENERGY_OPTIONS}
            selected={energy}
            onChange={(val) => setEnergy(val as 'high' | 'normal' | 'low')}
            variant="blue"
            equalWidth
          />
        </div>

        <div className="space-y-1.5">
          <label className="block font-semibold text-xs text-slate-300">
            Headache / Sugar Crash:
          </label>
          <ChipSelector
            options={HEADACHE_OPTIONS}
            selected={headache}
            onChange={(val) => setHeadache(val as 'none' | 'mild' | 'sugar_spike')}
            variant="rose"
            equalWidth
          />
        </div>

        <div>
          <input
            type="text"
            placeholder="Notes (e.g. felt hungry at 3pm, drank electrolytes)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-xs text-slate-100 placeholder-slate-500"
          />
        </div>

        <div className="flex gap-2.5 justify-end pt-1">
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="blue" size="md" onClick={handleSave}>
            Save Check-In
          </Button>
        </div>
      </div>
    </Modal>
  )
}
