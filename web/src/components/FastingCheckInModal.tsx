import { useState } from 'react'
import { Modal, OptionCardGroup, Button } from '@yggdrasil-lab/ui'
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
  const [notes, setNotes] = useState<string>(initialCheckIn?.notes ?? '')

  const handleSave = () => {
    const payload: FastingCheckIn = {
      id: initialCheckIn?.id ?? crypto.randomUUID(),
      date,
      target_window: targetWindow,
      adherence,
      ...(initialCheckIn?.energy ? { energy: initialCheckIn.energy } : {}),
      ...(initialCheckIn?.headache ? { headache: initialCheckIn.headache } : {}),
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
