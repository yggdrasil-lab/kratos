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

export function HRZoneBar({ zones, className = '', showLegend = true }: HRZoneBarProps) {
  const z1 = Number(zones.z1_recovery_pct || 0)
  const z2 = Number(zones.z2_aerobic_pct || 0)
  const z3 = Number(zones.z3_tempo_pct || 0)
  const z4 = Number(zones.z4_threshold_pct || 0)
  const z5 = Number(zones.z5_anaerobic_pct || 0)

  const total = z1 + z2 + z3 + z4 + z5
  if (total <= 0) return null

  // Normalize percentages so they sum to 100% of the bar width
  const w1 = (z1 / total) * 100
  const w2 = (z2 / total) * 100
  const w3 = (z3 / total) * 100
  const w4 = (z4 / total) * 100
  const w5 = (z5 / total) * 100

  const zoneItems = [
    { label: 'Z1 Rec', pct: z1, mins: zones.z1_mins, textColor: 'text-sky-400', dot: 'bg-sky-500' },
    { label: 'Z2 Base', pct: z2, mins: zones.z2_mins, textColor: 'text-emerald-400', dot: 'bg-emerald-500' },
    { label: 'Z3 Tempo', pct: z3, mins: zones.z3_mins, textColor: 'text-amber-400', dot: 'bg-amber-400' },
    { label: 'Z4 Thresh', pct: z4, mins: zones.z4_mins, textColor: 'text-orange-400', dot: 'bg-orange-500' },
    { label: 'Z5 Max', pct: z5, mins: zones.z5_mins, textColor: 'text-rose-400', dot: 'bg-rose-500' },
  ]

  return (
    <div className={`space-y-1.5 ${className}`}>
      {/* 5-Color Segmented Zone Bar */}
      <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-800/80 border border-slate-700/50 shadow-inner">
        {w1 > 0 && <div style={{ width: `${w1}%` }} className="h-full bg-sky-500 transition-all" title={`Zone 1: ${z1}%`} />}
        {w2 > 0 && <div style={{ width: `${w2}%` }} className="h-full bg-emerald-500 transition-all" title={`Zone 2: ${z2}%`} />}
        {w3 > 0 && <div style={{ width: `${w3}%` }} className="h-full bg-amber-400 transition-all" title={`Zone 3: ${z3}%`} />}
        {w4 > 0 && <div style={{ width: `${w4}%` }} className="h-full bg-orange-500 transition-all" title={`Zone 4: ${z4}%`} />}
        {w5 > 0 && <div style={{ width: `${w5}%` }} className="h-full bg-rose-500 transition-all" title={`Zone 5: ${z5}%`} />}
      </div>

      {/* Compact Zone Legend */}
      {showLegend && (
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-300">
          {zoneItems.map((item, idx) => {
            if (item.pct < 1 && (!item.mins || item.mins < 0.5)) return null
            return (
              <span key={idx} className="inline-flex items-center gap-1 font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
                <span className={item.textColor}>{item.label}</span>
                <span className="text-slate-400">{Math.round(item.pct)}%</span>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
