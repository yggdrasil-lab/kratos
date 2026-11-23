import { useEffect, useMemo, useState } from 'react'
import { AlertBanner, Button, Modal } from '@yggdrasil-lab/ui'
import { useSplitSessionPreview } from '../hooks/useSplitSessionPreview'
import type {
  Routine,
  SessionPayload,
  SplitSegmentInput,
  WorkoutRecommendation,
} from '../types'
import {
  appendSegmentBySplittingLast,
  applySuggestedSplitToSegments,
  createInitialSplitSegments,
  deriveDefaultEndIso,
  toSplitSegmentInputs,
  validateSplitDrafts,
  type SplitSegmentDraft,
} from '../utils/splitSession'
import { SplitSegmentCard } from './SplitSegmentCard'
import { SplitTimelineChart } from './SplitTimelineChart'

interface SplitSessionModalProps {
  session: SessionPayload | null
  routines: Routine[]
  workoutRecommendation: WorkoutRecommendation | null
  isOpen: boolean
  onClose: () => void
  onSaveSplit: (parentId: string, segments: SplitSegmentInput[]) => Promise<void>
  onSplitAndLogSets: (parentId: string, segments: SplitSegmentInput[]) => Promise<void>
}

function SplitModalFooter({
  hasRoutineSegment,
  isSubmitting,
  hasValidationError,
  onClose,
  onSubmit,
}: {
  hasRoutineSegment: boolean
  isSubmitting: boolean
  hasValidationError: boolean
  onClose: () => void
  onSubmit: (logSetsAfter: boolean) => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 flex-wrap pt-3 border-t border-border">
      <Button variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
        Cancel
      </Button>
      {hasRoutineSegment && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSubmit(true)}
          disabled={isSubmitting || hasValidationError}
        >
          Split &amp; Log Sets
        </Button>
      )}
      <Button
        variant="blue"
        size="sm"
        onClick={() => onSubmit(false)}
        disabled={isSubmitting || hasValidationError}
      >
        {isSubmitting ? 'Splitting...' : 'Save Split'}
      </Button>
    </div>
  )
}

function SplitSegmentList({
  segments,
  parentStartIso,
  parentEndIso,
  routines,
  workoutRecommendation,
  preview,
  onUpdateSegment,
  onRemoveSegment,
}: {
  segments: SplitSegmentDraft[]
  parentStartIso: string
  parentEndIso: string
  routines: Routine[]
  workoutRecommendation: WorkoutRecommendation | null
  preview: ReturnType<typeof useSplitSessionPreview>
  onUpdateSegment: (id: string, next: SplitSegmentDraft) => void
  onRemoveSegment: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      {segments.map((seg, idx) => (
        <SplitSegmentCard
          key={seg.id}
          index={idx}
          segment={seg}
          parentStartIso={parentStartIso}
          parentEndIso={parentEndIso}
          routines={routines}
          workoutRecommendation={workoutRecommendation}
          metrics={preview.metricsById[seg.id]}
          metricsLoading={Boolean(preview.metricsLoadingById[seg.id])}
          metricsError={preview.metricsErrorById[seg.id]}
          canRemove={segments.length > 2}
          onUpdate={(next) => onUpdateSegment(seg.id, next)}
          onRemove={() => onRemoveSegment(seg.id)}
        />
      ))}
    </div>
  )
}

/**
 * Modal for splitting a merged workout into 2-4 gap-aware segments backed by
 * Eir's 5-minute timeline hints and live per-window telemetry previews.
 */
export function SplitSessionModal({
  session,
  routines,
  workoutRecommendation,
  isOpen,
  onClose,
  onSaveSplit,
  onSplitAndLogSets,
}: SplitSessionModalProps) {
  const [segments, setSegments] = useState<SplitSegmentDraft[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const parentEndIso = useMemo(() => (session ? deriveDefaultEndIso(session) : ''), [session])

  useEffect(() => {
    if (!isOpen || !session) return
    setSegments(createInitialSplitSegments(session, routines, workoutRecommendation))
    setSubmitError(null)
  }, [isOpen, session, routines, workoutRecommendation])

  const preview = useSplitSessionPreview(isOpen, session, segments)
  if (!session) return null

  const validationError = validateSplitDrafts(segments)
  const hasRoutineSegment = segments.some((s) => s.mode === 'routine' && s.routineId !== null)

  const submitSplit = async (logSetsAfter: boolean) => {
    if (validationError) return setSubmitError(validationError)
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await (logSetsAfter ? onSplitAndLogSets : onSaveSplit)(session.id, toSplitSegmentInputs(segments))
      onClose()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to split workout')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Split Workout Session">
      <div className="space-y-4">
        <SplitTimelineChart
          bins={preview.timeline?.bins ?? []}
          suggestedSplits={preview.timeline?.suggested_splits ?? []}
          isLoading={preview.timelineLoading}
          errorMessage={preview.timelineError}
          onApplySuggestedSplit={(split) => setSegments((prev) => applySuggestedSplitToSegments(prev, split))}
        />
        {Boolean(validationError) && <AlertBanner variant="warning">{validationError}</AlertBanner>}
        {Boolean(submitError) && <AlertBanner variant="error">{submitError}</AlertBanner>}
        <SplitSegmentList
          segments={segments}
          parentStartIso={session.started_at}
          parentEndIso={parentEndIso}
          routines={routines}
          workoutRecommendation={workoutRecommendation}
          preview={preview}
          onUpdateSegment={(id, next) => setSegments((prev) => prev.map((it) => (it.id === id ? next : it)))}
          onRemoveSegment={(id) => setSegments((prev) => prev.filter((it) => it.id !== id))}
        />
        {segments.length < 4 && (
          <Button variant="secondary" size="sm" fullWidth onClick={() => setSegments((prev) => appendSegmentBySplittingLast(prev))}>
            + Add Segment ({segments.length}/4)
          </Button>
        )}
        <SplitModalFooter
          hasRoutineSegment={hasRoutineSegment}
          isSubmitting={isSubmitting}
          hasValidationError={Boolean(validationError)}
          onClose={onClose}
          onSubmit={(logSetsAfter) => void submitSplit(logSetsAfter)}
        />
      </div>
    </Modal>
  )
}
