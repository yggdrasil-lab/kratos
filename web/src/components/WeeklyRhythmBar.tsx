import { GlassCard } from '@yggdrasil-lab/ui'
import { DAY_SHORTS } from '../utils/circadian'

interface WeeklyRhythmBarProps {
  dayOfWeek: number
  weekDaySessions: boolean[]
}

/**
 * Monday-to-Sunday attendance strip highlighting completed sessions and today's slot.
 */
export function WeeklyRhythmBar({ dayOfWeek, weekDaySessions }: WeeklyRhythmBarProps) {
  return (
    <GlassCard className="animate-slide-up py-4 px-5">
      <div className="text-xs text-slate-400 font-semibold uppercase mb-2.5">
        Weekly Rhythm (Mon - Sun)
      </div>
      <div className="flex justify-between gap-1.5">
        {DAY_SHORTS.map((shortName, idx) => {
          const isToday = idx === dayOfWeek
          const isCompleted = weekDaySessions[idx]

          const icon = isCompleted ? '✓' : '○'
          const iconColor = isCompleted ? 'text-emerald-400' : 'text-slate-400'
          const boxClass = isToday
            ? 'bg-accent/15 border-accent'
            : isCompleted
            ? 'bg-emerald-500/20 border-emerald-500'
            : 'bg-background/50 border-border/60'

          return (
            <div
              key={shortName}
              className={`flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl border ${boxClass}`}
            >
              <span
                className={`text-[11px] ${
                  isToday ? 'text-accent font-bold' : 'text-slate-400 font-medium'
                }`}
              >
                {shortName}
              </span>
              <span className={`text-xs font-bold ${iconColor}`}>{icon}</span>
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}
