import { GlassCard } from '@yggdrasil-lab/ui'
import type { DailyBiometrics } from '../types'
import { computeReadinessTier } from '../utils/readiness'

interface ReadinessVitalsCardProps {
  biometrics: DailyBiometrics | null
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
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{readiness.emoji}</span>
          <span className={`font-bold text-sm ${readiness.textClass}`}>{readiness.label}</span>
        </div>
        {weightKg !== null && (
          <span className="text-xs text-slate-300 font-semibold">⚖️ {weightKg.toFixed(1)} kg</span>
        )}
      </div>

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
