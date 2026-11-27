import { useState } from 'react'
import {
  Button,
  CollapsibleSection,
  EmptyState,
  GoalProgressCard,
  SearchInput,
  SectionHeader,
} from '@yggdrasil-lab/ui'
import type { DailyBiometrics, Exercise, Routine, SessionPayload } from '../types'
import { getSessionLabel } from '../utils/session'
import { ProgressSessionCard } from './ProgressSessionCard'

interface ProgressViewProps {
  sessions: SessionPayload[]
  exercises: Exercise[]
  routines?: Routine[]
  biometrics: DailyBiometrics | null
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession: (session: SessionPayload) => void
  onSplitSession?: (session: SessionPayload) => void
  onLogSets?: (session: SessionPayload) => void
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
      <SearchInput value={search} onChange={setSearch} placeholder="Search older sessions..." variant="brand" className="mb-3" />
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

function RecentWorkoutsSection({
  recentSessions,
  exercises,
  routines,
  onDeleteSession,
  onConfirmSession,
  onEditSession,
  onSplitSession,
  onLogSets,
}: {
  recentSessions: SessionPayload[]
  exercises: Exercise[]
  routines: Routine[]
  onDeleteSession: (id: string) => Promise<void> | void
  onConfirmSession: (id: string) => Promise<void> | void
  onEditSession: (session: SessionPayload) => void
  onSplitSession?: (session: SessionPayload) => void
  onLogSets?: (session: SessionPayload) => void
}) {
  return (
    <div className="mb-4">
      <SectionHeader
        title={`Last 7 Days Workouts (${recentSessions.length})`}
        icon={<span className="text-base leading-none">🏋️</span>}
        variant="brand"
        size="md"
        className="mb-3"
      />
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
  )
}

/**
 * Progress and Momentum tab displaying weight milestone trajectory, 7-day activity
 * telemetry stream, and searchable older session archive.
 */
export function ProgressView({
  sessions,
  exercises,
  routines = [],
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
      <SectionHeader
        title="Progress and Momentum"
        subtitle="Milestone tracking, last 7 days activity, and correlations."
        titleAs="h2"
        size="md"
        variant="brand"
        className="mb-4"
      />

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
        variant="brand"
        className="mb-4"
      />

      <RecentWorkoutsSection
        recentSessions={recentSessions}
        exercises={exercises}
        routines={routines}
        onDeleteSession={onDeleteSession}
        onConfirmSession={onConfirmSession}
        onEditSession={onEditSession}
        onSplitSession={onSplitSession}
        onLogSets={onLogSets}
      />

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
