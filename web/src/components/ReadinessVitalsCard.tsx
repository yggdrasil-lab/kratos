import { GlassCard, SectionHeader } from '@yggdrasil-lab/ui'
import type { AccentVariant } from '@yggdrasil-lab/ui'
import type { DailyBiometrics } from '../types'
import { computeReadinessTier, type ReadinessTier } from '../utils/readiness'

interface ReadinessVitalsCardProps {
  biometrics: DailyBiometrics | null
}

const TIER_HEADER_VARIANT: Record<ReadinessTier, AccentVariant> = {
  optimal: 'emerald',
  moderate: 'amber',
  fatigued: 'rose',
}

/**
 * Displays today's readiness tier, coaching summary, and wearable vitals pills.
 */
export function ReadinessVitalsCard({ biometrics }: ReadinessVitalsCardProps) {
  const sleepHours = biometrics?.sleep_duration_hours ?? null
  const hrvMs = biometrics?.hrv_ms ? Number(biometrics.hrv_ms) : null
  const rhrBpm = biometrics?.resting_hr_bpm ?? null
  const weightKg = biometrics?.latest_weight_kg ? Number(biometrics.latest_weight_kg) : null
  const readiness = computeReadinessTier(biometrics)

  return (
    <GlassCard className={`animate-slide-up mb-4 ${readiness.borderClass}`}>
      <SectionHeader
        title={readiness.label}
        icon={<span className="text-base leading-none">{readiness.emoji}</span>}
        variant={TIER_HEADER_VARIANT[readiness.tier]}
        size="sm"
        className="mb-2"
        actions={
          weightKg !== null ? (
            <span className="text-xs text-slate-300 font-semibold">⚖️ {weightKg.toFixed(1)} kg</span>
          ) : undefined
        }
      />

      <p className="text-xs text-slate-300 mb-3">{readiness.message}</p>

      <div className="flex gap-2 flex-wrap">
        {sleepHours !== null && (
          <div className="bg-background/70 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-border/50">
            😴 Sleep: <strong className="text-slate-100">{sleepHours.toFixed(1)}h</strong>
            {biometrics?.sleep_deep_hours ? ` (${biometrics.sleep_deep_hours.toFixed(1)}h deep)` : ''}
          </div>
        )}
        {hrvMs !== null && (
          <div className="bg-background/70 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-border/50">
            💓 HRV: <strong className="text-slate-100">{Math.round(hrvMs)} ms</strong>
          </div>
        )}
        {rhrBpm !== null && (
          <div className="bg-background/70 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-border/50">
            🫀 RHR: <strong className="text-slate-100">{rhrBpm} bpm</strong>
          </div>
        )}
      </div>
    </GlassCard>
  )
}
