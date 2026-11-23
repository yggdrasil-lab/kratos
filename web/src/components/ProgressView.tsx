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
import { getSessionLabel } from '../utils/session'
import { ProgressSessionCard } from './ProgressSessionCard'

interface ProgressViewProps {
  sessions: SessionPayload[]
  exercises: Exercise[]
  routines?: Routine[]
  fastingLogs: FastingCheckIn[]
  biometrics: DailyBiometrics | null
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession: (session: SessionPayload) => void
  onSplitSession?: (session: SessionPayload) => void
  onLogSets?: (session: SessionPayload) => void
}

const ADHERENCE_BADGE_MAP: Record<FastingCheckIn['adherence'], { label: string; classes: string }> = {
  completed: { label: '✓ Completed', classes: 'bg-emerald-500/15 text-emerald-400' },
  early: { label: '⚡ Broke Early', classes: 'bg-amber-500/15 text-amber-400' },
  off_plan: { label: '🔴 Off-Plan', classes: 'bg-rose-500/15 text-rose-400' },
}

function FastingHistorySection({ fastingLogs }: { fastingLogs: FastingCheckIn[] }) {
  return (
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
                    {[f.energy ? `Energy: ${f.energy}` : null, f.headache ? `Headache: ${f.headache}` : null, f.notes ? `"${f.notes}"` : null]
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
  )
}

function OlderArchiveSection({
  olderSessions,
  routines,
  onEditSession,
  onDeleteSession,
  onLogSets,
}: {
  olderSessions: SessionPayload[]
  routines: Routine[]
  onEditSession: (session: SessionPayload) => void
  onDeleteSession: (id: string) => Promise<void> | void
  onLogSets?: (session: SessionPayload) => void
}) {
  const [search, setSearch] = useState<string>('')
  const normalizedQuery = search.trim().toLowerCase()
  const filteredArchive = normalizedQuery
    ? olderSessions.filter((s) => {
        const label = ((s.extra?.routine_name as string) || getSessionLabel(s, routines)).toLowerCase()
        return label.includes(normalizedQuery) || (s.notes || '').toLowerCase().includes(normalizedQuery)
      })
    : olderSessions

  return (
    <CollapsibleSection variant="card" title={`Older Sessions Archive (${olderSessions.length})`}>
      <SearchInput value={search} onChange={setSearch} placeholder="Search older sessions..." variant="blue" className="mb-3" />
      {filteredArchive.length === 0 ? (
        <EmptyState
          variant="dashed"
          title={olderSessions.length === 0 ? 'No older sessions match your search.' : 'No matching archived sessions'}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filteredArchive.map((s) => (
            <div key={s.id} className="px-3 py-2.5 rounded-xl bg-background/60 border border-border/50 flex justify-between items-center gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-100">{getSessionLabel(s, routines)}</div>
                <div className="text-[11px] text-slate-400">
                  {s.started_at.split('T')[0]} • {s.items.length} exercises
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {Boolean(s.routine_id) && onLogSets && (
                  <Button variant="secondary" size="xs" onClick={() => onLogSets(s)}>
                    {s.items.length === 0 ? 'Log Sets' : 'Edit Sets'}
                  </Button>
                )}
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
  )
}

function computeWeightProgress(biometrics: DailyBiometrics | null) {
  const startWeight = 90.0
  const targetWeight = 80.0
  const currentWeight = biometrics?.latest_weight_kg ? Number(biometrics.latest_weight_kg) : 86.65
  const totalToLose = startWeight - targetWeight
  const lostSoFar = Math.max(0, startWeight - currentWeight)
  const progressPercent = Math.min(100, Math.max(0, Math.round((lostSoFar / totalToLose) * 100)))
  const nextMilestone = currentWeight > 85.0 ? 85.0 : currentWeight > 82.5 ? 82.5 : 80.0
  return { currentWeight, lostSoFar, progressPercent, nextMilestone }
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
  onSplitSession,
  onLogSets,
}: ProgressViewProps) {
  const { currentWeight, lostSoFar, progressPercent, nextMilestone } = computeWeightProgress(biometrics)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const recentSessions = sessions.filter((s) => new Date(s.started_at) >= sevenDaysAgo)
  const olderSessions = sessions.filter((s) => new Date(s.started_at) < sevenDaysAgo)

  return (
    <div className="animate-fade-in pb-4">
      <div className="mb-4">
        <h2 className="text-2xl font-bold m-0 text-slate-100">Progress and Momentum</h2>
        <p className="text-xs text-slate-400 mt-1">Milestone tracking, last 7 days activity, and correlations.</p>
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
            {recentSessions.map((s) => (
              <ProgressSessionCard
                key={s.id}
                session={s}
                exercises={exercises}
                routines={routines}
                onDeleteSession={onDeleteSession}
                onConfirmSession={onConfirmSession}
                onEditSession={onEditSession}
                onSplitSession={onSplitSession}
                onLogSets={onLogSets}
              />
            ))}
          </div>
        )}
      </div>

      <FastingHistorySection fastingLogs={fastingLogs} />

      <OlderArchiveSection
        olderSessions={olderSessions}
        routines={routines}
        onEditSession={onEditSession}
        onDeleteSession={onDeleteSession}
        onLogSets={onLogSets}
      />
    </div>
  )
}
