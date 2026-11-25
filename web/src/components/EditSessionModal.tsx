import { useEffect, useMemo, useState } from 'react'
import {
  AlertBanner,
  Button,
  ChipSelector,
  FormField,
  Modal,
  OptionCardGroup,
  TextArea,
  TextInput,
  type OptionCardItem,
} from '@yggdrasil-lab/ui'
import { api } from '../api'
import type { ActivityType, EffortRating, Routine, SessionPayload, WorkoutMetrics } from '../types'
import { formatFriendlyDate } from '../utils/circadian'
import { getSessionLabel } from '../utils/session'
import {
  deriveDefaultEndIso,
  formatIsoToLocalHHMM,
  resolveEditedSessionTimestamps,
} from '../utils/splitSession'
import { extractSessionTelemetry, mergeRefreshedMetricsIntoExtra } from '../utils/telemetry'

interface EditSessionModalProps {
  session: SessionPayload | null
  routines: Routine[]
  sessions?: SessionPayload[]
  isOpen: boolean
  onClose: () => void
  onSave: (updated: SessionPayload) => Promise<void> | void
}

const EFFORT_OPTIONS: OptionCardItem<EffortRating>[] = [
  { value: 'too_easy', icon: '🟢', label: 'Too Easy', accent: 'emerald' },
  { value: 'optimal', icon: '🟡', label: 'Optimal', accent: 'amber' },
  { value: 'hard', icon: '🟠', label: 'Hard', accent: 'orange' },
  { value: 'too_hard', icon: '🔴', label: 'Too Hard', accent: 'rose' },
]

const ACTIVITY_TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'gym', label: 'Gym' },
  { value: 'class', label: 'Class' },
  { value: 'walk', label: 'Walk' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'swim', label: 'Swim' },
]

function inferInitialActivityType(session: SessionPayload): ActivityType {
  const raw =
    (typeof session.extra?.activity_type === 'string' && session.extra.activity_type) ||
    (typeof session.extra?.classification === 'string' && session.extra.classification) ||
    'gym'
  const lower = raw.toLowerCase()
  if (lower === 'class' || lower === 'walk' || lower === 'badminton' || lower === 'swim') {
    return lower
  }
  return 'gym'
}

function buildUpdatedEditSession(
  session: SessionPayload,
  routines: Routine[],
  params: {
    routineName: string
    activityType: ActivityType
    effortRating: EffortRating | null
    notes: string
    windowIso: { startedAt: string; endedAt: string }
    refreshedMetrics: WorkoutMetrics | null
  }
): SessionPayload {
  const finalName = params.routineName.trim() || 'Gym Session'
  const matchedRoutine =
    params.activityType === 'class'
      ? undefined
      : routines.find((r) => r.name.toLowerCase() === finalName.toLowerCase())
  const timesChanged =
    params.windowIso.startedAt !== new Date(session.started_at).toISOString() ||
    params.windowIso.endedAt !== deriveDefaultEndIso(session)

  const baseExtra: Record<string, unknown> = {
    ...(session.extra || {}),
    routine_name: finalName,
    activity_name: finalName,
    activity_type: params.activityType,
    classification: params.activityType,
    inferred: false,
    confirmed: true,
  }
  if (params.effortRating) {
    baseExtra.effort_rating = params.effortRating
  } else {
    delete baseExtra.effort_rating
  }
  return {
    ...session,
    routine_id: matchedRoutine ? matchedRoutine.id : null,
    started_at: params.windowIso.startedAt,
    ended_at: params.windowIso.endedAt,
    notes: params.notes.trim() || null,
    extra: mergeRefreshedMetricsIntoExtra(
      baseExtra,
      params.refreshedMetrics,
      timesChanged,
      params.effortRating
    ),
  }
}

function EditTimeAndTypeInputs({
  startTime,
  endTime,
  activityType,
  onStartTimeChange,
  onEndTimeChange,
  onActivityTypeChange,
}: {
  startTime: string
  endTime: string
  activityType: ActivityType
  onStartTimeChange: (v: string) => void
  onEndTimeChange: (v: string) => void
  onActivityTypeChange: (v: ActivityType) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Start Time" htmlFor="edit-session-start-time">
          <TextInput
            id="edit-session-start-time"
            type="time"
            aria-label="Start Time"
            variant="blue"
            value={startTime}
            onChange={(e) => onStartTimeChange(e.target.value)}
          />
        </FormField>
        <FormField label="End Time" htmlFor="edit-session-end-time">
          <TextInput
            id="edit-session-end-time"
            type="time"
            aria-label="End Time"
            variant="blue"
            value={endTime}
            onChange={(e) => onEndTimeChange(e.target.value)}
          />
        </FormField>
      </div>

      <FormField label="Activity Type">
        <ChipSelector
          options={ACTIVITY_TYPE_OPTIONS}
          selected={activityType}
          onChange={(val) => onActivityTypeChange(val as ActivityType)}
          variant="blue"
        />
      </FormField>
    </>
  )
}

function EditTelemetryRefreshBar({
  session,
  refreshedMetrics,
  isRefreshing,
  refreshError,
  onRefresh,
}: {
  session: SessionPayload
  refreshedMetrics: WorkoutMetrics | null
  isRefreshing: boolean
  refreshError: string | null
  onRefresh: () => void
}) {
  const {
    durationMinutes: duration,
    activeEnergyKcal: kcal,
    avgHrBpm: avgHr,
  } = extractSessionTelemetry(session, refreshedMetrics)

  return (
    <div className="rounded-xl bg-background/70 border border-border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-slate-300 flex items-center gap-2 flex-wrap">
          {duration !== null && <span>⏱️ {duration}m</span>}
          {kcal !== null && <span>🔥 {kcal} kcal</span>}
          {avgHr !== null && <span>❤️ {avgHr} bpm</span>}
          {duration === null && kcal === null && avgHr === null && (
            <span className="text-slate-400">No wearable telemetry attached yet</span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="kratos-touch-target"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? 'Refreshing...' : 'Refresh Eir Telemetry'}
        </Button>
      </div>
      {Boolean(refreshError) && <AlertBanner variant="error">{refreshError}</AlertBanner>}
    </div>
  )
}

function EditLabelAndNotesFields({
  routineName,
  presetOptions,
  selectedPreset,
  effortRating,
  notes,
  onRoutineNameChange,
  onEffortChange,
  onNotesChange,
}: {
  routineName: string
  presetOptions: string[]
  selectedPreset: string | undefined
  effortRating: EffortRating | null
  notes: string
  onRoutineNameChange: (v: string) => void
  onEffortChange: (v: EffortRating) => void
  onNotesChange: (v: string) => void
}) {
  return (
    <>
      <FormField label="Workout / Routine Name" htmlFor="edit-session-routine-name">
        <TextInput
          id="edit-session-routine-name"
          type="text"
          variant="blue"
          value={routineName}
          onChange={(e) => onRoutineNameChange(e.target.value)}
          placeholder="Enter routine or activity name..."
        />
        <ChipSelector
          options={presetOptions}
          selected={selectedPreset}
          onChange={onRoutineNameChange}
          variant="blue"
          className="mt-2"
        />
      </FormField>

      <OptionCardGroup
        label="Effort Rating (RPE)"
        options={EFFORT_OPTIONS}
        value={(effortRating ?? '') as EffortRating}
        onChange={onEffortChange}
      />

      <FormField label="Notes & Observations" htmlFor="edit-session-notes">
        <TextArea
          id="edit-session-notes"
          rows={2}
          variant="blue"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="How did this session feel? Any joint feedback or PRs?"
        />
      </FormField>
    </>
  )
}

function useEditSessionForm(
  session: SessionPayload | null,
  routines: Routine[],
  sessions?: SessionPayload[]
) {
  const [routineName, setRoutineName] = useState<string>('')
  const [activityType, setActivityType] = useState<ActivityType>('gym')
  const [startTime, setStartTime] = useState<string>('')
  const [endTime, setEndTime] = useState<string>('')
  const [effortRating, setEffortRating] = useState<EffortRating | null>(null)
  const [notes, setNotes] = useState<string>('')
  const [refreshedMetrics, setRefreshedMetrics] = useState<WorkoutMetrics | null>(null)
  const [isRefreshingMetrics, setIsRefreshingMetrics] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    setRoutineName(getSessionLabel(session, routines))
    setActivityType(inferInitialActivityType(session))
    setStartTime(formatIsoToLocalHHMM(session.started_at))
    setEndTime(formatIsoToLocalHHMM(deriveDefaultEndIso(session)))
    setEffortRating((session.extra?.effort_rating as EffortRating) || null)
    setNotes(session.notes || '')
    setRefreshedMetrics(null)
    setErrorMessage(null)
  }, [session, routines])

  const presetOptions = useMemo(() => {
    const fromRoutines = routines.map((r) => r.name.trim()).filter(Boolean)
    const fromSessions = (sessions || [])
      .map((s) => ((s.extra?.routine_name as string) || (s.extra?.activity_name as string) || '').trim())
      .filter(Boolean)
    const combined = Array.from(new Set([...fromRoutines, ...fromSessions]))
    return combined.length > 0 ? combined : ['Gym Session']
  }, [routines, sessions])

  return {
    routineName,
    setRoutineName,
    activityType,
    setActivityType,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    effortRating,
    setEffortRating,
    notes,
    setNotes,
    refreshedMetrics,
    setRefreshedMetrics,
    isRefreshingMetrics,
    setIsRefreshingMetrics,
    errorMessage,
    setErrorMessage,
    presetOptions,
  }
}

function useEditSessionActions(
  session: SessionPayload | null,
  routines: Routine[],
  form: ReturnType<typeof useEditSessionForm>,
  onSave: (updated: SessionPayload) => Promise<void> | void,
  onClose: () => void
) {
  const [isSaving, setIsSaving] = useState<boolean>(false)

  const handleRefreshTelemetry = async () => {
    if (!session) return
    const windowIso = resolveEditedSessionTimestamps(session.started_at, session.ended_at, form.startTime, form.endTime)
    if (!windowIso) return form.setErrorMessage('End time must be after start time.')
    form.setIsRefreshingMetrics(true)
    form.setErrorMessage(null)
    try {
      const data = await api.getWorkoutMetrics({
        started_at: windowIso.startedAt,
        ended_at: windowIso.endedAt,
        activity_type: form.activityType,
        classification: form.activityType,
        routine_name: form.routineName.trim() || undefined,
      })
      form.setRefreshedMetrics(data)
      form.setEffortRating((data.effort_rating as EffortRating | null) ?? null)
    } catch (err) {
      form.setErrorMessage(err instanceof Error ? err.message : 'Failed to refresh Eir telemetry')
    } finally {
      form.setIsRefreshingMetrics(false)
    }
  }

  const handleSave = async () => {
    if (!session) return
    const windowIso = resolveEditedSessionTimestamps(session.started_at, session.ended_at, form.startTime, form.endTime)
    if (!windowIso) return form.setErrorMessage('End time must be after start time.')
    setIsSaving(true)
    form.setErrorMessage(null)
    try {
      await onSave(
        buildUpdatedEditSession(session, routines, {
          routineName: form.routineName,
          activityType: form.activityType,
          effortRating: form.effortRating,
          notes: form.notes,
          windowIso,
          refreshedMetrics: form.refreshedMetrics,
        })
      )
      onClose()
    } catch (err) {
      form.setErrorMessage(err instanceof Error ? err.message : 'Failed to save session changes')
    } finally {
      setIsSaving(false)
    }
  }

  return { isSaving, handleRefreshTelemetry, handleSave }
}

/**
 * Modal for editing a logged workout session's label, timestamps, activity type,
 * Eir telemetry refresh, RPE rating, and notes.
 */
export function EditSessionModal({
  session,
  routines,
  sessions,
  isOpen,
  onClose,
  onSave,
}: EditSessionModalProps) {
  const form = useEditSessionForm(session, routines, sessions)
  const actions = useEditSessionActions(session, routines, form, onSave, onClose)
  if (!session) return null

  const sessionDate = session.started_at ? session.started_at.split('T')[0] : ''
  const selectedPreset = form.presetOptions.find((p) => p.toLowerCase() === form.routineName.toLowerCase())

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Workout Details"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={actions.isSaving}>
            Cancel
          </Button>
          <Button variant="blue" size="sm" onClick={() => void actions.handleSave()} disabled={actions.isSaving}>
            {actions.isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {Boolean(sessionDate) && (
          <div className="text-xs text-slate-400">
            Session Date: <span className="text-slate-200 font-semibold">{formatFriendlyDate(sessionDate)}</span>
          </div>
        )}
        <EditTimeAndTypeInputs
          startTime={form.startTime}
          endTime={form.endTime}
          activityType={form.activityType}
          onStartTimeChange={form.setStartTime}
          onEndTimeChange={form.setEndTime}
          onActivityTypeChange={form.setActivityType}
        />
        <EditTelemetryRefreshBar
          session={session}
          refreshedMetrics={form.refreshedMetrics}
          isRefreshing={form.isRefreshingMetrics}
          refreshError={form.errorMessage}
          onRefresh={() => void actions.handleRefreshTelemetry()}
        />
        <EditLabelAndNotesFields
          routineName={form.routineName}
          presetOptions={form.presetOptions}
          selectedPreset={selectedPreset}
          effortRating={form.effortRating}
          notes={form.notes}
          onRoutineNameChange={form.setRoutineName}
          onEffortChange={(val) => form.setEffortRating(form.effortRating === val ? null : val)}
          onNotesChange={form.setNotes}
        />
      </div>
    </Modal>
  )
}
