import { useState } from 'react'
import type { EffortRating, Exercise, SessionPayload } from '../types'

interface EffortDebriefModalProps {
  session: SessionPayload
  exercises: Exercise[]
  onSave: (effort: EffortRating, tags: string[], notes: string) => void
  onSkip: () => void
}

const EFFORT_OPTIONS: { rating: EffortRating; label: string; desc: string; color: string; emoji: string }[] = [
  {
    rating: 'too_easy',
    emoji: '🟢',
    label: 'Too Easy',
    desc: 'Plenty left in the tank. Ready for weight bump next time.',
    color: '#10b981',
  },
  {
    rating: 'optimal',
    emoji: '🟡',
    label: 'Just Right / Optimal',
    desc: 'Hit true technical failure on target sets. Solid fatigue.',
    color: '#f59e0b',
  },
  {
    rating: 'hard',
    emoji: '🟠',
    label: 'Challenging / Hard',
    desc: 'Pushed to the limits. Will need recovery before next session.',
    color: '#f97316',
  },
  {
    rating: 'too_hard',
    emoji: '🔴',
    label: 'Too Hard / Cooked',
    desc: 'Missed target reps, form breakdown, or joints felt uncomfortable.',
    color: '#ef4444',
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

  // Calculate session summary stats
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

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  const handleComplete = () => {
    onSave(selectedRating, selectedTags, notes.trim())
  }

  return (
    <div className="modal-backdrop animate-fade-in" style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(15, 23, 42, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '1rem',
      overflowY: 'auto',
    }}>
      <div className="glass-panel animate-scale-up" style={{
        maxWidth: '520px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        border: '1px solid var(--surface-border)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
        padding: '1.5rem',
      }}>
        {/* Celebration Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>🎉</div>
          <h2 style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>Workout Complete!</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {durationMinutes} min • {Math.round(totalVolumeKg).toLocaleString()} kg volume • {completedSetsCount} sets finished
          </p>
        </div>

        {/* Effort Rating Selection */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.75rem' }}>
            How much effort did this take?
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {EFFORT_OPTIONS.map((opt) => {
              const isSelected = selectedRating === opt.rating
              return (
                <button
                  key={opt.rating}
                  type="button"
                  onClick={() => setSelectedRating(opt.rating)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.75rem',
                    padding: '0.75rem 1rem',
                    borderRadius: '0.75rem',
                    textAlign: 'left',
                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    border: `1.5px solid ${isSelected ? opt.color : 'rgba(255, 255, 255, 0.08)'}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{opt.emoji}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem', color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      {opt.desc}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Quick Context Tags */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Quick reflections (optional):
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {QUICK_TAGS.map((tag) => {
              const isSelected = selectedTags.includes(tag)
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  style={{
                    padding: '0.35rem 0.7rem',
                    borderRadius: '2rem',
                    fontSize: '0.8rem',
                    fontWeight: 500,
                    backgroundColor: isSelected ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${isSelected ? 'var(--accent-color)' : 'rgba(255, 255, 255, 0.1)'}`,
                    color: isSelected ? '#c084fc' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {tag}
                </button>
              )
            })}
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="text"
            placeholder="Add note (e.g. form felt smooth, or tight hamstring)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              width: '100%',
              padding: '0.65rem 0.9rem',
              borderRadius: '0.6rem',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onSkip}
            style={{ padding: '0.75rem 1.25rem', fontSize: '0.9rem' }}
          >
            Skip
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleComplete}
            style={{ padding: '0.75rem 1.75rem', fontSize: '0.95rem', fontWeight: 600 }}
          >
            Save and Finish
          </button>
        </div>
      </div>
    </div>
  )
}
