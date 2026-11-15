import { MultiSegmentBar, type MultiSegmentItem } from '@yggdrasil-lab/ui'

export interface HRZonesData {
  z1_recovery_pct?: number
  z2_aerobic_pct?: number
  z3_tempo_pct?: number
  z4_threshold_pct?: number
  z5_anaerobic_pct?: number
  z1_mins?: number
  z2_mins?: number
  z3_mins?: number
  z4_mins?: number
  z5_mins?: number
}

interface HRZoneBarProps {
  zones: HRZonesData
  className?: string
  showLegend?: boolean
}

interface ZoneSpec {
  id: string
  label: string
  pctKey: keyof HRZonesData
  minsKey: keyof HRZonesData
  barColor: string
  textColor: string
}

const ZONE_SPECS: ZoneSpec[] = [
  { id: 'z1', label: 'Z1 Rec', pctKey: 'z1_recovery_pct', minsKey: 'z1_mins', barColor: 'bg-sky-500', textColor: 'text-sky-400' },
  { id: 'z2', label: 'Z2 Base', pctKey: 'z2_aerobic_pct', minsKey: 'z2_mins', barColor: 'bg-emerald-500', textColor: 'text-emerald-400' },
  { id: 'z3', label: 'Z3 Tempo', pctKey: 'z3_tempo_pct', minsKey: 'z3_mins', barColor: 'bg-amber-400', textColor: 'text-amber-400' },
  { id: 'z4', label: 'Z4 Thresh', pctKey: 'z4_threshold_pct', minsKey: 'z4_mins', barColor: 'bg-orange-500', textColor: 'text-orange-400' },
  { id: 'z5', label: 'Z5 Max', pctKey: 'z5_anaerobic_pct', minsKey: 'z5_mins', barColor: 'bg-rose-500', textColor: 'text-rose-400' },
]

/**
 * Domain adapter mapping Apple Health / Kratos 5-zone heart rate percentages
 * to @yggdrasil-lab/ui's MultiSegmentBar.
 */
export function HRZoneBar({ zones, className = '', showLegend = true }: HRZoneBarProps) {
  const segments: MultiSegmentItem[] = ZONE_SPECS.map((spec) => {
    const pct = Number(zones[spec.pctKey] || 0)
    const mins = zones[spec.minsKey]
    const hasSignificantMins = typeof mins === 'number' && mins >= 0.5 && pct > 0
    return {
      id: spec.id,
      label: spec.label,
      value: pct,
      barColor: spec.barColor,
      textColor: spec.textColor,
      valueLabel: `${Math.round(pct)}%`,
      minVisiblePct: hasSignificantMins ? 0.01 : 1,
    }
  })

  return (
    <MultiSegmentBar
      segments={segments}
      showLegend={showLegend}
      heightClass="h-2"
      className={className}
    />
  )
}
