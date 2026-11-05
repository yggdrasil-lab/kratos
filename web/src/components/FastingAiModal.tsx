import { useState } from 'react'
import { createPortal } from 'react-dom'

interface FastingAiModalProps {
  currentCitation?: string | null
  onSynthesize: (customContext?: string) => Promise<void>
  onClose: () => void
}

export function FastingAiModal({
  currentCitation,
  onSynthesize,
  onClose,
}: FastingAiModalProps) {
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
      setError('Synthesis failed. Please verify Muninn connection or try again.')
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
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🧠</span>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Adaptive Fasting Synthesizer
              </h3>
            </div>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: '#60a5fa' }}>
              Sports Physiology & Circadian Research Grounding
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
            padding: '0.75rem',
            marginBottom: '1rem',
            fontSize: '0.78rem',
          }}
        >
          <div style={{ fontWeight: 600, color: '#93c5fd', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <span>📚</span>
            <span>{currentCitation || 'Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)'}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--text-secondary)', lineHeight: 1.45, fontSize: '0.75rem' }}>
            <li>
              <strong>Circadian TRE:</strong> 8-10h window ending 3-4h prior to sleep to preserve nocturnal HRV and deep sleep.
            </li>
            <li>
              <strong>MPS Distribution:</strong> 0.4-0.5 g/kg protein spaced across 3-4 meals on lifting days with post-lift anchor.
            </li>
            <li>
              <strong>Court Glycogen:</strong> Pre-match carbs and electrolytes 2-3h before badminton; post-match amino acids.
            </li>
            <li>
              <strong>Metabolic Reset:</strong> 18:6 autophagy fasts reserved strictly for low-strain recovery days.
            </li>
          </ul>
        </div>

        {/* Input for Schedule Shifts or Context */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label
            htmlFor="ai-context-input"
            style={{
              display: 'block',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '0.4rem',
            }}
          >
            Day Shifts or Custom Schedule (Optional)
          </label>
          <textarea
            id="ai-context-input"
            rows={3}
            value={customContext}
            onChange={(e) => setCustomContext(e.target.value)}
            disabled={isBusy}
            placeholder="e.g. Lunch at 1:30 PM with team; badminton moved to 7:00 PM; feeling slightly sore from deadlifts"
            style={{
              width: '100%',
              backgroundColor: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '0.5rem',
              padding: '0.6rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.82rem',
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
            <span>{isBusy ? 'Synthesizing...' : 'Synthesize with AI'}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
