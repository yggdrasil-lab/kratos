import { useState } from 'react'
import { GlassCard, GoalProgressCard, CollapsibleSection, Button } from '@yggdrasil-lab/ui'
import type { DailyBiometrics, Exercise, FastingCheckIn, SessionPayload } from '../types'
import { formatFriendlyDate } from '../utils/circadian'

interface ProgressViewProps {
  sessions: SessionPayload[]
  exercises: Exercise[]
  fastingLogs: FastingCheckIn[]
  biometrics: DailyBiometrics | null
  onDeleteSession: (id: string) => Promise<void>
}

export function ProgressView({
  sessions,
  exercises,
  fastingLogs,
  biometrics,
  onDeleteSession,
}: ProgressViewProps) {
  const [search, setSearch] = useState<string>('')

  const startWeight = 90.0
  const targetWeight = 80.0
  const currentWeight = biometrics?.latest_weight_kg ? Number(biometrics.latest_weight_kg) : 86.65
  const totalToLose = startWeight - targetWeight
  const lostSoFar = Math.max(0, startWeight - currentWeight)
  const progressPercent = Math.min(100, Math.max(0, Math.round((lostSoFar / totalToLose) * 100)))

  const nextMilestone = currentWeight > 85.0 ? 85.0 : currentWeight > 82.5 ? 82.5 : 80.0

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const recentSessions = sessions.filter((s) => new Date(s.started_at) >= sevenDaysAgo)
  const olderSessions = sessions.filter((s) => new Date(s.started_at) < sevenDaysAgo)

  const filteredArchive = search.trim()
    ? olderSessions.filter((s) => {
        const routineName = (s.extra?.routine_name as string) || ''
        const notes = s.notes || ''
        return routineName.toLowerCase().includes(search.toLowerCase()) || notes.toLowerCase().includes(search.toLowerCase())
      })
    : olderSessions

  const getExerciseName = (id: string) => {
    const ex = exercises.find((e) => e.id === id)
    return ex ? ex.name : 'Exercise'
  }

  const computeSessionStats = (s: SessionPayload) => {
    let volume = 0
    let sets = 0
    s.items.forEach((it) => {
      it.sets.forEach((set) => {
        if (set.status === 'done') {
          sets += 1
          volume += (set.weight_kg ?? 0) * (set.reps ?? 0)
        }
      })
    })
    const durationMins = s.ended_at
      ? Math.max(1, Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 60000))
      : null
    return { volume: Math.round(volume), sets, durationMins }
  }

  return (
    <div className="animate-fade-in pb-16">
      {/* Title */}
      <div className="mb-5">
        <h2 className="text-2xl font-bold m-0 text-slate-100">
          Progress and Momentum
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Milestone tracking, last 7 days activity, and correlations.
        </p>
      </div>

      {/* 1. Goal Milestone Tracker (80kg Goal) */}
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
        className="mb-6"
      />

      {/* 2. Last 7 Days Completed Activity Stream */}
      <div className="mb-6">
        <h3 className="text-base font-bold mb-3 flex items-center gap-2 text-slate-100">
          <span>🏋️</span> Last 7 Days Workouts ({recentSessions.length})
        </h3>

        {recentSessions.length === 0 ? (
          <GlassCard className="p-6 text-center text-slate-400 text-xs">
            No workouts logged in the last 7 days. Tap &quot;Today&quot; to start your next session!
          </GlassCard>
        ) : (
          <div className="flex flex-col gap-3">
            {recentSessions.map((s) => {
              const stats = computeSessionStats(s)
              const effort = (s.extra?.effort_rating as string) || ''
              const tags = (s.extra?.effort_tags as string[]) || []
              const routineName = (s.extra?.routine_name as string) || 'Gym Session'
              const dateStr = s.started_at.split('T')[0]

              let effortBadge = null
              if (effort === 'too_easy') {
                effortBadge = <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 font-semibold">🟢 Too Easy</span>
              } else if (effort === 'optimal') {
                effortBadge = <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 font-semibold">🟡 Optimal</span>
              } else if (effort === 'hard') {
                effortBadge = <span className="text-[11px] px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-400 font-semibold">🟠 Hard</span>
              } else if (effort === 'too_hard') {
                effortBadge = <span className="text-[11px] px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-400 font-semibold">🔴 Too Hard</span>
              }

              return (
                <GlassCard key={s.id} className="p-4">
                  <div className="flex justify-between items-start mb-1.5">
                    <div>
                      <div className="text-xs text-slate-400">
                        {formatFriendlyDate(dateStr)}
                      </div>
                      <div className="font-bold text-base text-slate-100">
                        {routineName}
                      </div>
                    </div>
                    {effortBadge}
                  </div>

                  {/* Summary row */}
                  <div className="text-xs text-slate-300 mb-2 flex gap-3">
                    {stats.durationMins && <span>⏱️ {stats.durationMins} min</span>}
                    <span>📦 {stats.volume.toLocaleString()} kg volume</span>
                    <span>✓ {stats.sets} sets</span>
                  </div>

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {tags.map((t, idx) => (
                        <span key={idx} className="text-[11px] text-purple-300 bg-purple-500/15 px-2 py-0.5 rounded-md">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Performed exercise pills */}
                  <div className="text-xs text-slate-400 flex flex-wrap gap-1.5">
                    {s.items.map((it) => (
                      <span key={it.id} className="bg-background/60 px-2 py-0.5 rounded-md border border-border/50">
                        {getExerciseName(it.exercise_id)} ({it.sets.filter((x) => x.status === 'done').length} sets)
                      </span>
                    ))}
                  </div>

                  {/* Reflection Notes */}
                  {s.notes && (
                    <div className="text-xs text-slate-300 mt-2 italic">
                      &ldquo;{s.notes}&rdquo;
                    </div>
                  )}
                </GlassCard>
              )
            })}
          </div>
        )}
      </div>

      {/* 3. Fasting History Stream */}
      <div className="mb-6">
        <h3 className="text-base font-bold mb-3 flex items-center gap-2 text-slate-100">
          <span>⏱️</span> Fasting History ({fastingLogs.length})
        </h3>

        {fastingLogs.length === 0 ? (
          <GlassCard className="p-5 text-center text-slate-400 text-xs">
            No fasting logs recorded yet. Use the Fasting Card on &quot;Today&quot; to log your check-ins!
          </GlassCard>
        ) : (
          <div className="flex flex-col gap-2">
            {fastingLogs.slice(0, 7).map((f) => {
              const badgeClass =
                f.adherence === 'completed'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : f.adherence === 'early'
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-rose-500/15 text-rose-400'

              return (
                <GlassCard key={f.id} className="px-4 py-3 flex justify-between items-center gap-2">
                  <div>
                    <div className="font-semibold text-xs text-slate-100">
                      {formatFriendlyDate(f.date)} ({f.target_window})
                    </div>
                    <div className="text-xs text-slate-400">
                      Energy: {f.energy} • Headache: {f.headache}
                      {f.notes ? ` • "${f.notes}"` : ''}
                    </div>
                  </div>

                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md shrink-0 ${badgeClass}`}>
                    {f.adherence === 'completed' ? '✓ Completed' : f.adherence === 'early' ? '⚡ Broke Early' : '🔴 Off-Plan'}
                  </span>
                </GlassCard>
              )
            })}
          </div>
        )}
      </div>

      {/* 4. Older History Collapsible Archive */}
      <CollapsibleSection
        variant="card"
        title={`Older Sessions Archive (${olderSessions.length})`}
      >
        <input
          type="text"
          placeholder="Search older sessions..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs text-slate-100 mb-3"
        />

        {filteredArchive.length === 0 ? (
          <div className="text-xs text-slate-400 text-center py-4">
            No older sessions match your search.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredArchive.map((s) => (
              <div
                key={s.id}
                className="px-3 py-2.5 rounded-xl bg-background/60 border border-border/50 flex justify-between items-center"
              >
                <div>
                  <div className="text-xs font-semibold text-slate-100">
                    {(s.extra?.routine_name as string) || 'Gym Session'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {s.started_at.split('T')[0]} • {s.items.length} exercises
                  </div>
                </div>
                <Button
                  variant="danger"
                  size="xs"
                  onClick={() => onDeleteSession(s.id)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}
