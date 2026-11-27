import { GlassCard, SectionHeader } from '@yggdrasil-lab/ui'
import type { DailyBiometrics } from '../types'
import { resolveReadinessSummary, resolveVitalsDisplay } from '../utils/readiness'

interface ReadinessVitalsCardProps {
  biometrics: DailyBiometrics | null
}

function VitalPill({ icon, label, value, detail }: {
  icon: string
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="bg-background/70 px-2.5 py-1 rounded-lg text-xs text-slate-300 border border-border/50">
      {icon} {label}: <strong className="text-slate-100">{value}</strong>
      {detail ?? ''}
    </div>
  )
}

/**
 * Displays today's backend readiness tier, coaching summary, and wearable vitals pills.
 */
export function ReadinessVitalsCard({ biometrics }: ReadinessVitalsCardProps) {
  const { sleepHours, deepSleepHours, napHours, hrvMs, rhrBpm, weightKg } =
    resolveVitalsDisplay(biometrics)
  const readiness = resolveReadinessSummary(biometrics)
  const weightAction =
    weightKg !== null ? (
      <span className="text-xs text-slate-300 font-semibold">⚖️ {weightKg.toFixed(1)} kg</span>
    ) : undefined

  return (
    <GlassCard className={`animate-slide-up mb-4 ${readiness.borderClass}`}>
      <SectionHeader
        title={readiness.label}
        icon={<span className="text-base leading-none">{readiness.emoji}</span>}
        variant={readiness.headerVariant}
        size="sm"
        className="mb-2"
        actions={weightAction}
      />
      <p className="text-xs text-slate-300 mb-3">{readiness.message}</p>
      <div className="flex gap-2 flex-wrap">
        {sleepHours !== null && (
          <VitalPill
            icon="😴"
            label="Sleep"
            value={`${sleepHours.toFixed(1)}h`}
            detail={deepSleepHours !== null ? ` (${deepSleepHours.toFixed(1)}h deep)` : undefined}
          />
        )}
        {napHours !== null && <VitalPill icon="🛌" label="Nap" value={`${napHours.toFixed(1)}h`} />}
        {hrvMs !== null && <VitalPill icon="💓" label="HRV" value={`${Math.round(hrvMs)} ms`} />}
        {rhrBpm !== null && <VitalPill icon="🫀" label="RHR" value={`${rhrBpm} bpm`} />}
      </div>
    </GlassCard>
  )
}
