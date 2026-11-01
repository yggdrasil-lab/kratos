import { useState } from 'react'
import type { FastingCheckIn } from '../types'
import { FastingCheckInModal } from './FastingCheckInModal'

interface FastingCardProps {
  circadianDate: string
  dayOfWeek: number // 0 = Mon, ..., 6 = Sun
  latestCheckIn?: FastingCheckIn
  onSaveCheckIn: (checkIn: FastingCheckIn) => void
}

export function FastingCard({
  circadianDate,
  dayOfWeek,
  latestCheckIn,
  onSaveCheckIn,
}: FastingCardProps) {
  const [showModal, setShowModal] = useState<boolean>(false)

  // Determine today's protocol based on day of week
  let protocolName = '16:8 Standard Split'
  let targetWindow = '16:8'
  let windowHours = '12:30 PM - 8:30 PM'
  let fuelingAnchors: string[] = [
    '12:30 PM: Break fast with 40g protein + complex carbs',
    '07:00 PM: High protein dinner + greens',
    'Post-Dinner: 15-20 min walk to blunt glucose spike',
  ]

  if (dayOfWeek === 4) {
    // Friday: Deep Reset
    protocolName = '18:6 Deep Metabolic Reset'
    targetWindow = '18:6'
    windowHours = '4:30 PM - 8:30 PM'
    fuelingAnchors = [
      'Morning: High water + black coffee + pink salt/electrolytes',
      '04:30 PM: Break fast with dense protein + healthy fats',
      'Goal: Deep fat oxidation after Thursday badminton glycogen burn',
    ]
  } else if (dayOfWeek === 1 || dayOfWeek === 3) {
    // Tuesday / Thursday: Badminton Fueling
    protocolName = '16:8 Badminton Court Fueling'
    targetWindow = '16:8'
    windowHours = '12:00 PM - 9:30 PM'
    fuelingAnchors = [
      '12:00 PM: Balanced lunch with clean complex carbs',
      '05:00 PM: Pre-court fuel (oats + whey, banana, electrolytes)',
      '09:30 PM: Light protein shake after court (close window by 10 PM)',
    ]
  } else if (dayOfWeek === 5 || dayOfWeek === 6) {
    // Weekend
    protocolName = '14:10 Social Baseline'
    targetWindow = '14:10'
    windowHours = '10:30 AM - 8:30 PM'
    fuelingAnchors = [
      'Mindful portions with family and friends',
      'Prioritize hydration and avoid high-sugar snacks',
    ]
  }

  const isCheckedInToday = latestCheckIn && latestCheckIn.date === circadianDate

  return (
    <>
      <div className="glass-panel animate-slide-up" style={{
        marginBottom: '1.25rem',
        padding: '1.25rem',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.5), rgba(15, 23, 42, 0.7))',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.25rem' }}>⏱️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                Fasting and Fueling
              </div>
              <div style={{ fontSize: '0.75rem', color: '#60a5fa', fontWeight: 600 }}>
                {protocolName}
              </div>
            </div>
          </div>

          {isCheckedInToday ? (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.25rem 0.6rem',
              borderRadius: '1rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              backgroundColor: latestCheckIn.adherence === 'completed'
                ? 'rgba(16, 185, 129, 0.2)'
                : latestCheckIn.adherence === 'early'
                ? 'rgba(245, 158, 11, 0.2)'
                : 'rgba(239, 68, 68, 0.2)',
              color: latestCheckIn.adherence === 'completed'
                ? '#10b981'
                : latestCheckIn.adherence === 'early'
                ? '#f59e0b'
                : '#ef4444',
            }}>
              {latestCheckIn.adherence === 'completed' ? '✓ Completed' : latestCheckIn.adherence === 'early' ? '⚡ Early' : '🔴 Off-Plan'}
            </span>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowModal(true)}
              style={{
                padding: '0.3rem 0.75rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderColor: 'var(--primary-color)',
                color: '#60a5fa',
              }}
            >
              Log Fast
            </button>
          )}
        </div>

        {/* Target Window Bar */}
        <div style={{
          backgroundColor: 'rgba(0, 0, 0, 0.25)',
          borderRadius: '0.5rem',
          padding: '0.6rem 0.8rem',
          marginBottom: '0.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Target Window</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{windowHours}</span>
        </div>

        {/* Fueling Anchors List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {fuelingAnchors.map((anchor, idx) => (
            <div key={idx} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
              <span style={{ color: 'var(--primary-hover)', marginTop: '0.1rem' }}>•</span>
              <span>{anchor}</span>
            </div>
          ))}
        </div>

        {/* Existing Check-In Summary if already logged */}
        {isCheckedInToday && (
          <div style={{
            marginTop: '0.75rem',
            paddingTop: '0.6rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>Logged: Energy {latestCheckIn.energy} • Headache {latestCheckIn.headache}</span>
            <button
              type="button"
              onClick={() => setShowModal(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                textDecoration: 'underline',
                fontSize: '0.75rem',
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {showModal && (
        <FastingCheckInModal
          date={circadianDate}
          targetWindow={targetWindow}
          onSave={(checkIn) => {
            onSaveCheckIn(checkIn)
            setShowModal(false)
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
