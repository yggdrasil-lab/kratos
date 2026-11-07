import { useState, useEffect, useMemo } from 'react'
import { Modal, Button } from '@yggdrasil-lab/ui'
import type { EffortRating, Routine, SessionPayload } from '../types'
import { getSessionLabel } from '../utils/session'
import { formatFriendlyDate } from '../utils/circadian'

interface EditSessionModalProps {
  session: SessionPayload | null
  routines: Routine[]
  sessions?: SessionPayload[]
  isOpen: boolean
  onClose: () => void
  onSave: (updated: SessionPayload) => Promise<void> | void
}

const EFFORT_OPTIONS: { value: EffortRating; label: string; activeClass: string }[] = [
  { value: 'too_easy', label: '🟢 Too Easy', activeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  { value: 'optimal', label: '🟡 Optimal', activeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { value: 'hard', label: '🟠 Hard', activeClass: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  { value: 'too_hard', label: '🔴 Too Hard', activeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
]

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

        {/* 1. Activity / Routine Name */}
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

          {/* Quick preset chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {presetOptions.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRoutineName(preset)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${
                  routineName.toLowerCase() === preset.toLowerCase()
                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/50 font-semibold'
                    : 'bg-background/80 text-slate-400 border-border/60 hover:text-slate-200'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* 2. Effort Rating */}
        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            Effort Rating (RPE)
          </label>
          <div className="grid grid-cols-2 gap-2">
            {EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEffortRating(effortRating === opt.value ? null : opt.value)}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-center transition-all ${
                  effortRating === opt.value
                    ? opt.activeClass
                    : 'bg-background/70 text-slate-400 border-border/50 hover:bg-background'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Reflection Notes */}
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

        {/* Action Buttons */}
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
