import { useState } from 'react'
import type { FastingCheckIn } from '../types'

interface FastingCheckInModalProps {
  date: string
  targetWindow: string
  onSave: (checkIn: FastingCheckIn) => void
  onClose: () => void
}

export function FastingCheckInModal({ date, targetWindow, onSave, onClose }: FastingCheckInModalProps) {
  const [adherence, setAdherence] = useState<'completed' | 'early' | 'off_plan'>('completed')
  const [energy, setEnergy] = useState<'high' | 'normal' | 'low'>('normal')
  const [headache, setHeadache] = useState<'none' | 'mild' | 'sugar_spike'>('none')
  const [notes, setNotes] = useState<string>('')

  const handleSave = () => {
    const payload: FastingCheckIn = {
      id: crypto.randomUUID(),
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
        maxWidth: '480px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        border: '1px solid var(--surface-border)',
        boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
        padding: '1.5rem',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ fontSize: '1.3rem', fontWeight: 700 }}>Fasting Check-In</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Target: {targetWindow} for {date}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.4rem',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Adherence Selection */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            Did you follow today's fasting window?
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button
              type="button"
              onClick={() => setAdherence('completed')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.7rem 0.9rem',
                borderRadius: '0.6rem',
                backgroundColor: adherence === 'completed' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                border: `1.5px solid ${adherence === 'completed' ? '#10b981' : 'rgba(255, 255, 255, 0.08)'}`,
                color: adherence === 'completed' ? '#10b981' : 'var(--text-primary)',
                fontWeight: 600,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span>🟢</span>
              <div>
                <div>Completed Target Window</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>Hit full fast target</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAdherence('early')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.7rem 0.9rem',
                borderRadius: '0.6rem',
                backgroundColor: adherence === 'early' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                border: `1.5px solid ${adherence === 'early' ? '#f59e0b' : 'rgba(255, 255, 255, 0.08)'}`,
                color: adherence === 'early' ? '#f59e0b' : 'var(--text-primary)',
                fontWeight: 600,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span>🟡</span>
              <div>
                <div>Broke Fast Early</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>Broke 1-2h before target window</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setAdherence('off_plan')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.7rem 0.9rem',
                borderRadius: '0.6rem',
                backgroundColor: adherence === 'off_plan' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                border: `1.5px solid ${adherence === 'off_plan' ? '#ef4444' : 'rgba(255, 255, 255, 0.08)'}`,
                color: adherence === 'off_plan' ? '#ef4444' : 'var(--text-primary)',
                fontWeight: 600,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span>🔴</span>
              <div>
                <div>Off-Plan / Skipped Fast</div>
                <div style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-muted)' }}>Ate early breakfast or continuous grazing</div>
              </div>
            </button>
          </div>
        </div>

        {/* Energy Level */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
            Energy level during the fast:
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[
              { val: 'high', label: '⚡ High' },
              { val: 'normal', label: '😐 Normal' },
              { val: 'low', label: '🪫 Low' },
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setEnergy(opt.val as any)}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '0.5rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  backgroundColor: energy === opt.val ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${energy === opt.val ? 'var(--primary-color)' : 'rgba(255, 255, 255, 0.08)'}`,
                  color: energy === opt.val ? '#60a5fa' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Headaches / Sugar Crashes */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
            Headache / Sugar Crash:
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {[
              { val: 'none', label: 'None' },
              { val: 'mild', label: 'Mild' },
              { val: 'sugar_spike', label: 'Sugar Spike' },
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => setHeadache(opt.val as any)}
                style={{
                  flex: 1,
                  padding: '0.5rem',
                  borderRadius: '0.5rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  backgroundColor: headache === opt.val ? 'rgba(244, 63, 94, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: `1px solid ${headache === opt.val ? '#f43f5e' : 'rgba(255, 255, 255, 0.08)'}`,
                  color: headache === opt.val ? '#f43f5e' : 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Optional Notes */}
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            type="text"
            placeholder="Notes (e.g. felt hungry at 3pm, drank electrolytes)..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              width: '100%',
              padding: '0.6rem 0.8rem',
              borderRadius: '0.5rem',
              backgroundColor: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--surface-border)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ padding: '0.6rem 1.2rem' }}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} style={{ padding: '0.6rem 1.5rem', fontWeight: 600 }}>
            Save Check-In
          </button>
        </div>
      </div>
    </div>
  )
}
