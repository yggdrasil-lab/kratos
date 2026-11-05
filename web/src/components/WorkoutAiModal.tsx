import { useState } from 'react'
import { createPortal } from 'react-dom'

interface WorkoutAiModalProps {
  currentCitation?: string | null
  onSynthesize: (customContext?: string) => Promise<void>
  onClose: () => void
}

export function WorkoutAiModal({
  currentCitation,
  onSynthesize,
  onClose,
}: WorkoutAiModalProps) {
  const [customContext, setCustomContext] = useState<string>('')
  const [isBusy, setIsBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const handleSynthesize = async () => {
    setIsBusy(true)
    setError(null)
    try {
      await onSynthesize(customContext.trim() || undefined)
      onClose()
    } catch {
      setError('Workout synthesis failed. Please verify Muninn connection or try again.')
    } finally {
      setIsBusy(false)
    }
  }

  return createPortal(
    <div
      className="modal-backdrop animate-fade-in"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        zIndex: 1000,
      }}
    >
      <div
        className="glass-panel animate-scale-up modal-card"
        style={{
          width: '100%',
          maxWidth: '480px',
          maxHeight: '92vh',
          overflowY: 'auto',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '1rem',
          padding: '1.15rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🧠</span>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Adaptive Workout Synthesizer
              </h3>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#60a5fa' }}>
              Hypertrophy Science & Biomechanics Grounding
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '1.2rem',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0.2rem',
            }}
          >
            ✕
          </button>
        </div>

        {/* Research Framework Pill */}
        <div
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            borderRadius: '0.5rem',
            padding: '0.6rem 0.75rem',
            marginBottom: '0.85rem',
            fontSize: '0.76rem',
          }}
        >
          <div style={{ fontWeight: 600, color: '#93c5fd', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span>📚</span>
            <span>{currentCitation || 'Israetel (Volume Landmarks) & Helms (RIR Autoregulation)'}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--text-secondary)', lineHeight: 1.4, fontSize: '0.73rem' }}>
            <li>
              <strong>Volume Landmarks (RP):</strong> Sets scaled between MEV (2 sets deload on fatigue) and MAV (3+ overload sets).
            </li>
            <li>
              <strong>RIR Autoregulation:</strong> Target RIR dictated by recovery score (RIR 1-2 on primed days; RIR 3-4 on fatigue).
            </li>
            <li>
              <strong>Joint Sparing (McGill):</strong> Neutral grips and chest-supported variations to spare impinged shoulders/spine.
            </li>
            <li>
              <strong>Court Freshness:</strong> Preserves leg power and avoids eccentric damage adjacent to badminton match play.
            </li>
          </ul>
        </div>

        {/* Input for Body State / Time Constraints */}
        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="workout-ai-context-input"
            style={{
              display: 'block',
              fontSize: '0.78rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '0.35rem',
            }}
          >
            Constraints, Body State, or Schedule Shifts (Optional)
          </label>
          <textarea
            id="workout-ai-context-input"
            rows={2}
            value={customContext}
            onChange={(e) => setCustomContext(e.target.value)}
            disabled={isBusy}
            placeholder="e.g. Left shoulder is pinching on incline; only have 35 minutes today; badminton left my calves sore"
            style={{
              width: '100%',
              backgroundColor: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '0.5rem',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div style={{ marginBottom: '1rem', color: '#ef4444', fontSize: '0.78rem' }}>
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isBusy}
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSynthesize}
            disabled={isBusy}
            style={{
              padding: '0.5rem 1.25rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: '#2563eb',
            }}
          >
            <span>⚡</span>
            <span>{isBusy ? 'Synthesizing...' : 'Synthesize Training'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
