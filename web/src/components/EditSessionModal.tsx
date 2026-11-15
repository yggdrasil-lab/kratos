import { useEffect, useMemo, useState } from 'react'
import { Button, ChipSelector, Modal, OptionCardGroup, type OptionCardItem } from '@yggdrasil-lab/ui'
import type { EffortRating, Routine, SessionPayload } from '../types'
import { formatFriendlyDate } from '../utils/circadian'
import { getSessionLabel } from '../utils/session'

interface EditSessionModalProps {
  session: SessionPayload | null
  routines: Routine[]
  sessions?: SessionPayload[]
  isOpen: boolean
  onClose: () => void
  onSave: (updated: SessionPayload) => Promise<void> | void
}

const EFFORT_OPTIONS: OptionCardItem<EffortRating>[] = [
  { value: 'too_easy', icon: '🟢', label: 'Too Easy', accent: 'emerald' },
  { value: 'optimal', icon: '🟡', label: 'Optimal', accent: 'amber' },
  { value: 'hard', icon: '🟠', label: 'Hard', accent: 'orange' },
  { value: 'too_hard', icon: '🔴', label: 'Too Hard', accent: 'rose' },
]

/**
 * Modal for editing a logged workout session's routine label, RPE rating, and notes.
 */
export function EditSessionModal({
  session,
  routines,
  sessions,
  isOpen,
  onClose,
  onSave,
}: EditSessionModalProps) {
  const [routineName, setRoutineName] = useState<string>('')
  const [effortRating, setEffortRating] = useState<EffortRating | null>(null)
  const [notes, setNotes] = useState<string>('')
  const [isSaving, setIsSaving] = useState<boolean>(false)

  useEffect(() => {
    if (session) {
      setRoutineName(getSessionLabel(session, routines))
      setEffortRating((session.extra?.effort_rating as EffortRating) || null)
      setNotes(session.notes || '')
    }
  }, [session, routines])

  const presetOptions = useMemo(() => {
    const fromRoutines = routines.map((r) => r.name.trim()).filter(Boolean)
    const fromSessions = (sessions || [])
      .map((s) => {
        const name = (s.extra?.routine_name as string) || (s.extra?.activity_name as string) || ''
        return name.trim()
      })
      .filter(Boolean)
    const combined = Array.from(new Set([...fromRoutines, ...fromSessions]))
    return combined.length > 0 ? combined : ['Gym Session']
  }, [routines, sessions])

  if (!session) return null

  const sessionDate = session.started_at ? session.started_at.split('T')[0] : ''
  const selectedPreset = presetOptions.find(
    (preset) => preset.toLowerCase() === routineName.toLowerCase()
  )

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const finalName = routineName.trim() || 'Gym Session'
      const matchedRoutine = routines.find(
        (r) => r.name.toLowerCase() === finalName.toLowerCase()
      )

      const updatedSession: SessionPayload = {
        ...session,
        routine_id: matchedRoutine ? matchedRoutine.id : session.routine_id,
        notes: notes.trim() || null,
        extra: {
          ...(session.extra || {}),
          routine_name: finalName,
          activity_name: finalName,
          effort_rating: effortRating || undefined,
          inferred: false,
          confirmed: true,
        },
      }

      await onSave(updatedSession)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Workout Details">
      <div className="space-y-4">
        {sessionDate && (
          <div className="text-xs text-slate-400">
            Session Date: <span className="text-slate-200 font-semibold">{formatFriendlyDate(sessionDate)}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Workout / Routine Name
          </label>
          <input
            type="text"
            value={routineName}
            onChange={(e) => setRoutineName(e.target.value)}
            placeholder="Enter routine or activity name..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />

          <ChipSelector
            options={presetOptions}
            selected={selectedPreset}
            onChange={setRoutineName}
            variant="blue"
            className="mt-2"
          />
        </div>

        <OptionCardGroup
          label="Effort Rating (RPE)"
          options={EFFORT_OPTIONS}
          value={(effortRating ?? '') as EffortRating}
          onChange={(val) => setEffortRating(effortRating === val ? null : val)}
        />

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Notes & Observations
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="How did this session feel? Any joint feedback or PRs?"
            className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-border text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button variant="blue" size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
