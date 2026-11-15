import { useState } from 'react'
import {
  Button,
  CollapsibleSection,
  EmptyState,
  GlassCard,
  GoalProgressCard,
  SearchInput,
} from '@yggdrasil-lab/ui'
import type { DailyBiometrics, Exercise, FastingCheckIn, Routine, SessionPayload } from '../types'
import { formatFriendlyDate } from '../utils/circadian'
import { computeSessionVolumeAndSets, getSessionLabel } from '../utils/session'
import { getExerciseDisplayName, getSessionDurationMinutes } from '../utils/sessionMetrics'
import { EffortBadge } from './EffortBadge'
import { HRZoneBar, type HRZonesData } from './HRZoneBar'

interface ProgressViewProps {
  sessions: SessionPayload[]
  exercises: Exercise[]
  routines?: Routine[]
  fastingLogs: FastingCheckIn[]
  biometrics: DailyBiometrics | null
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession: (session: SessionPayload) => void
}

const ADHERENCE_BADGE_MAP: Record<FastingCheckIn['adherence'], { label: string; classes: string }> = {
  completed: { label: '✓ Completed', classes: 'bg-emerald-500/15 text-emerald-400' },
  early: { label: '⚡ Broke Early', classes: 'bg-amber-500/15 text-amber-400' },
  off_plan: { label: '🔴 Off-Plan', classes: 'bg-rose-500/15 text-rose-400' },
}

/**
 * Progress and Momentum tab displaying weight milestone trajectory, 7-day activity
 * telemetry stream, fasting adherence logs, and searchable older session archive.
 */
export function ProgressView({
  sessions,
  exercises,
  routines = [],
  fastingLogs,
  biometrics,
  onDeleteSession,
  onConfirmSession,
  onEditSession,
}: ProgressViewProps) {
  const [search, setSearch] = useState<string>('')

  const startWeight = 90.0
  const targetWeight = 80.0
  const currentWeight = biometrics?.latest_weight_kg
    ? Number(biometrics.latest_weight_kg)
    : 86.65
  const totalToLose = startWeight - targetWeight
  const lostSoFar = Math.max(0, startWeight - currentWeight)
  const progressPercent = Math.min(100, Math.max(0, Math.round((lostSoFar / totalToLose) * 100)))
  const nextMilestone = currentWeight > 85.0 ? 85.0 : currentWeight > 82.5 ? 82.5 : 80.0

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const recentSessions = sessions.filter((s) => new Date(s.started_at) >= sevenDaysAgo)
  const olderSessions = sessions.filter((s) => new Date(s.started_at) < sevenDaysAgo)

  const normalizedQuery = search.trim().toLowerCase()
  const filteredArchive = normalizedQuery
    ? olderSessions.filter((s) => {
        const label = ((s.extra?.routine_name as string) || getSessionLabel(s, routines)).toLowerCase()
        const notes = (s.notes || '').toLowerCase()
        return label.includes(normalizedQuery) || notes.includes(normalizedQuery)
      })
    : olderSessions

  return (
    <div className="animate-fade-in pb-4">
      <div className="mb-4">
        <h2 className="text-2xl font-bold m-0 text-slate-100">Progress and Momentum</h2>
        <p className="text-xs text-slate-400 mt-1">
          Milestone tracking, last 7 days activity, and correlations.
        </p>
      </div>

      <GoalProgressCard
        eyebrow="Goal: Reach 80 kg"
        currentValueLabel={`${currentWeight.toFixed(1)} kg`}
        deltaLabel={`(-${lostSoFar.toFixed(1)} kg)`}
        deltaPositive={true}
        milestoneLabel="Next Milestone"
        milestoneValue={`${nextMilestone.toFixed(1)} kg`}
        progressPercent={progressPercent}
        startLabel="Start: 90.0 kg"
        centerLabel={`${progressPercent}% towards 80 kg`}
        targetLabel="Target: 80.0 kg"
        variant="blue"
        className="mb-4"
      />

      <div className="mb-4">
        <h3 className="text-base font-bold mb-3 flex items-center gap-2 text-slate-100">
          <span>🏋️</span> Last 7 Days Workouts ({recentSessions.length})
        </h3>

        {recentSessions.length === 0 ? (
          <EmptyState
            variant="glass"
            title="No workouts logged in the last 7 days"
            description='Tap "Today" to start your next session!'
          />
        ) : (
          <div className="flex flex-col gap-3">
            {recentSessions.map((s) => {
              const { volume, sets } = computeSessionVolumeAndSets(s, exercises)
              const durationMins = getSessionDurationMinutes(s)
              const effort = (s.extra?.effort_rating as string) || ''
              const rpe = s.extra?.rpe as number | undefined
              const trimp = s.extra?.trimp as number | undefined
              const hrZones = s.extra?.hr_zones as HRZonesData | undefined
              const avgHr = s.extra?.avg_hr as number | undefined
              const peakHr = s.extra?.peak_hr as number | undefined
              const activeEnergy = s.extra?.active_energy_kcal as number | undefined
              const stepCount = s.extra?.step_count as number | undefined
              const hrRecovery = s.extra?.hr_recovery_60s as number | undefined
              const tags = (s.extra?.effort_tags as string[]) || []
              const routineName = getSessionLabel(s, routines)
              const dateStr = s.started_at.split('T')[0]
              const isInferred = Boolean(s.extra?.inferred)

              return (
                <GlassCard key={s.id} className="p-4">
                  <div className="flex justify-between items-start mb-1.5 gap-2">
                    <div>
                      <div className="text-xs text-slate-400">{formatFriendlyDate(dateStr)}</div>
                      <div className="font-bold text-base text-slate-100">{routineName}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {isInferred && (
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1">
                          ⚡ Inferred from Plan
                        </span>
                      )}
                      <EffortBadge effort={effort} />
                      {rpe !== undefined && rpe !== null && (
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/25 font-semibold">
                          RPE {rpe}
                        </span>
                      )}
                      {trimp !== undefined && trimp !== null && trimp > 0 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/25 font-semibold">
                          TRIMP {Math.round(trimp)}
                        </span>
                      )}
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => onEditSession(s)}
                        title="Edit Workout Details"
                      >
                        Change
                      </Button>
                    </div>
                  </div>

                  {isInferred && (
                    <div className="bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 my-2 flex items-center justify-between gap-2 flex-wrap">
                      <div className="text-xs text-amber-200/90 flex-1 min-w-[180px]">
                        Auto-detected from plan and biometrics. Keep or dismiss?
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="blue" size="xs" onClick={() => onConfirmSession(s.id)}>
                          ✓ Confirm
                        </Button>
                        <Button variant="secondary" size="xs" onClick={() => onEditSession(s)}>
                          Change
                        </Button>
                        <Button variant="danger" size="xs" onClick={() => onDeleteSession(s.id)}>
                          ✕ Dismiss
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-slate-300 mb-2 flex gap-3 flex-wrap">
                    {durationMins ? <span>⏱️ {durationMins} min</span> : null}
                    {volume > 0 ? (
                      <>
                        <span>📦 {volume.toLocaleString()} kg volume</span>
                        <span>✓ {sets} sets</span>
                      </>
                    ) : null}
                    {activeEnergy ? <span>🔥 {activeEnergy} kcal</span> : null}
                    {stepCount ? <span>👟 {stepCount.toLocaleString()} steps</span> : null}
                  </div>

                  {(avgHr || hrRecovery) && (
                    <div className="text-xs text-slate-300 mb-2 flex items-center gap-3 flex-wrap">
                      {avgHr ? (
                        <span className="inline-flex items-center gap-1">
                          ❤️ <span className="font-medium text-slate-200">{avgHr} bpm avg</span>
                          {peakHr ? <span className="text-slate-400">({peakHr} max)</span> : null}
                        </span>
                      ) : null}
                      {hrRecovery ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                          ⏱️ <span>Drop -{hrRecovery} bpm</span>
                        </span>
                      ) : null}
                    </div>
                  )}

                  {hrZones && (
                    <div className="my-2.5">
                      <HRZoneBar zones={hrZones} />
                    </div>
                  )}

                  {tags.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {tags.map((t, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="text-xs text-slate-400 flex flex-wrap gap-1.5">
                    {s.items.map((it) => (
                      <span
                        key={it.id}
                        className="bg-background/60 px-2 py-0.5 rounded-md border border-border/50"
                      >
                        {getExerciseDisplayName(it.exercise_id, exercises)} (
                        {it.sets.filter((x) => x.status === 'done').length} sets)
                      </span>
                    ))}
                  </div>

                  {s.notes && <div className="text-xs text-slate-300 mt-2">&ldquo;{s.notes}&rdquo;</div>}
                </GlassCard>
              )
            })}
          </div>
        )}
      </div>

      <div className="mb-4">
        <h3 className="text-base font-bold mb-3 flex items-center gap-2 text-slate-100">
          <span>⏱️</span> Fasting History ({fastingLogs.length})
        </h3>

        {fastingLogs.length === 0 ? (
          <EmptyState
            variant="glass"
            title="No fasting logs recorded yet"
            description='Use the Fasting Card on "Today" to log your check-ins!'
          />
        ) : (
          <div className="flex flex-col gap-2">
            {fastingLogs.slice(0, 7).map((f) => {
              const badge = ADHERENCE_BADGE_MAP[f.adherence] || ADHERENCE_BADGE_MAP.off_plan

              return (
                <GlassCard key={f.id} className="px-4 py-3 flex justify-between items-center gap-2">
                  <div>
                    <div className="font-semibold text-xs text-slate-100">
                      {formatFriendlyDate(f.date)} ({f.target_window})
                    </div>
                    <div className="text-xs text-slate-400">
                      {[
                        f.energy ? `Energy: ${f.energy}` : null,
                        f.headache ? `Headache: ${f.headache}` : null,
                        f.notes ? `"${f.notes}"` : null,
                      ]
                        .filter(Boolean)
                        .join(' • ')}
                    </div>
                  </div>

                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md shrink-0 ${badge.classes}`}>
                    {badge.label}
                  </span>
                </GlassCard>
              )
            })}
          </div>
        )}
      </div>

      <CollapsibleSection
        variant="card"
        title={`Older Sessions Archive (${olderSessions.length})`}
      >
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search older sessions..."
          variant="blue"
          className="mb-3"
        />

        {filteredArchive.length === 0 ? (
          <EmptyState
            variant="dashed"
            title={
              olderSessions.length === 0
                ? 'No older sessions match your search.'
                : 'No matching archived sessions'
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {filteredArchive.map((s) => (
              <div
                key={s.id}
                className="px-3 py-2.5 rounded-xl bg-background/60 border border-border/50 flex justify-between items-center"
              >
                <div>
                  <div className="text-xs font-semibold text-slate-100">
                    {getSessionLabel(s, routines)}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {s.started_at.split('T')[0]} • {s.items.length} exercises
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="secondary" size="xs" onClick={() => onEditSession(s)}>
                    Change
                  </Button>
                  <Button variant="danger" size="xs" onClick={() => onDeleteSession(s.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}
