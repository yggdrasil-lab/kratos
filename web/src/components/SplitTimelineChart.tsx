import { Button } from '@yggdrasil-lab/ui'
import type { SuggestedSplitPoint, WorkoutTimelineBin } from '../types'
import { formatIsoToLocalHHMM } from '../utils/splitSession'

interface SplitTimelineChartProps {
  bins: WorkoutTimelineBin[]
  suggestedSplits: SuggestedSplitPoint[]
  isLoading: boolean
  errorMessage: string | null
  onApplySuggestedSplit: (split: SuggestedSplitPoint) => void
}

function computeBarHeightPct(avgHr: number | null | undefined, minHr: number, maxHr: number): number {
  if (typeof avgHr !== 'number' || Number.isNaN(avgHr)) return 18
  if (maxHr <= minHr) return 60
  const normalized = (avgHr - minHr) / (maxHr - minHr)
  return Math.max(20, Math.min(100, Math.round(24 + normalized * 76)))
}

function TimelineBinsBar({ bins }: { bins: WorkoutTimelineBin[] }) {
  const hrValues = bins
    .map((b) => b.avg_hr_bpm)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v))
  const minHr = hrValues.length > 0 ? Math.min(...hrValues) : 90
  const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : 175

  return (
    <div className="space-y-2">
      <div className="kratos-timeline-bars" data-testid="timeline-bars-track">
        {bins.map((bin) => {
          const heightPct = computeBarHeightPct(bin.avg_hr_bpm, minHr, maxHr)
          const startLabel = formatIsoToLocalHHMM(bin.started_at)
          const hrText = typeof bin.avg_hr_bpm === 'number' ? `${bin.avg_hr_bpm} bpm` : 'No HR'
          const barClass = bin.is_active_watch_mode
            ? 'kratos-timeline-bin-bar kratos-timeline-bin-bar--active'
            : 'kratos-timeline-bin-bar kratos-timeline-bin-bar--passive'

          return (
            <div
              key={bin.started_at}
              className="kratos-timeline-bin-col"
              data-testid="timeline-bin-col"
              title={`${startLabel}: ${hrText}, ${bin.step_count} steps, ${Math.round(bin.active_energy_kcal)} kcal`}
            >
              <div
                className={barClass}
                data-testid="timeline-bin-bar"
                style={{ height: `${heightPct}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 font-mono">
        <span>{formatIsoToLocalHHMM(bins[0]?.started_at)}</span>
        <span>{formatIsoToLocalHHMM(bins[bins.length - 1]?.ended_at)}</span>
      </div>
    </div>
  )
}

function SuggestedSplitsList({
  suggestedSplits,
  onApplySuggestedSplit,
}: {
  suggestedSplits: SuggestedSplitPoint[]
  onApplySuggestedSplit: (split: SuggestedSplitPoint) => void
}) {
  if (suggestedSplits.length === 0) return null
  return (
    <div className="space-y-2 pt-2 border-t border-border/60">
      {suggestedSplits.map((split) => {
        const splitLabel = formatIsoToLocalHHMM(split.split_at)
        const resumeLabel = formatIsoToLocalHHMM(split.resume_at)
        const windowText =
          splitLabel === resumeLabel ? splitLabel : `${splitLabel} -> ${resumeLabel}`

        return (
          <div
            key={`${split.split_at}-${split.resume_at}`}
            className="kratos-suggested-split-card"
            data-testid="suggested-split-card"
          >
            <div>
              <div className="text-xs font-semibold text-sky-300">
                Suggested Split: {windowText}
              </div>
              <div className="text-[11px] text-slate-300">{split.reason}</div>
            </div>
            <Button
              variant="blue"
              size="sm"
              className="kratos-touch-target shrink-0"
              onClick={() => onApplySuggestedSplit(split)}
            >
              Apply Suggested Split
            </Button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Displays Eir 5-minute HR/step timeline bins, active Watch mode indicators,
 * and one-tap suggested split-point buttons.
 */
export function SplitTimelineChart({
  bins,
  suggestedSplits,
  isLoading,
  errorMessage,
  onApplySuggestedSplit,
}: SplitTimelineChartProps) {
  const activeWatchBins = bins.filter((b) => b.is_active_watch_mode).length

  return (
    <div className="kratos-timeline-panel" data-testid="split-timeline-chart">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-200">5-Min HR &amp; Step Timeline</span>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] px-2 py-1 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 font-semibold">
            ⌚ Active Watch ({activeWatchBins})
          </span>
          <span className="text-[11px] px-2 py-1 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/25 font-medium">
            Passive HR
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-400 py-4 text-center animate-pulse">
          Loading Eir heart rate and step bins...
        </div>
      ) : errorMessage ? (
        <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2">
          Timeline preview unavailable: {errorMessage}
        </div>
      ) : bins.length === 0 ? (
        <div className="text-xs text-slate-400 py-3 text-center">
          No 5-minute telemetry bins found for this window. Adjust times manually below.
        </div>
      ) : (
        <TimelineBinsBar bins={bins} />
      )}

      <SuggestedSplitsList
        suggestedSplits={suggestedSplits}
        onApplySuggestedSplit={onApplySuggestedSplit}
      />
    </div>
  )
}
