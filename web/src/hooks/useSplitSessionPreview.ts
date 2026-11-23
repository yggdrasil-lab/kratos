import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { SessionPayload, WorkoutMetrics, WorkoutTimelineResponse } from '../types'
import { deriveDefaultEndIso, type SplitSegmentDraft } from '../utils/splitSession'

export interface SplitPreviewState {
  timeline: WorkoutTimelineResponse | null
  timelineLoading: boolean
  timelineError: string | null
  metricsById: Record<string, WorkoutMetrics>
  metricsLoadingById: Record<string, boolean>
  metricsErrorById: Record<string, string>
}

function previewSegmentMetrics(
  seg: SplitSegmentDraft,
  setLoading: (id: string, loading: boolean) => void,
  setMetrics: (id: string, data: WorkoutMetrics) => void,
  setError: (id: string, msg: string | null) => void
): void {
  const startMs = new Date(seg.startedAt).getTime()
  const endMs = new Date(seg.endedAt).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs) return

  setLoading(seg.id, true)
  setError(seg.id, null)
  const activityParam =
    seg.mode === 'class' ? 'class' : seg.mode === 'routine' ? 'gym' : seg.activityType

  void api
    .getWorkoutMetrics({
      started_at: seg.startedAt,
      ended_at: seg.endedAt,
      activity_type: activityParam,
      classification: activityParam,
      routine_name: seg.routineName || undefined,
    })
    .then((data) => setMetrics(seg.id, data))
    .catch((err) =>
      setError(seg.id, err instanceof Error ? err.message : 'Eir preview unavailable')
    )
    .finally(() => setLoading(seg.id, false))
}

/**
 * Fetches Eir 5-min HR/step timeline on open and debounces per-segment workout-metrics previews.
 */
export function useSplitSessionPreview(
  isOpen: boolean,
  session: SessionPayload | null,
  segments: SplitSegmentDraft[]
): SplitPreviewState {
  const [timeline, setTimeline] = useState<WorkoutTimelineResponse | null>(null)
  const [timelineLoading, setTimelineLoading] = useState<boolean>(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [metricsById, setMetricsById] = useState<Record<string, WorkoutMetrics>>({})
  const [metricsLoadingById, setMetricsLoadingById] = useState<Record<string, boolean>>({})
  const [metricsErrorById, setMetricsErrorById] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!isOpen || !session) return
    setMetricsById({})
    setMetricsErrorById({})
    setTimeline(null)
    setTimelineError(null)
    setTimelineLoading(true)
    let cancelled = false
    void api
      .getWorkoutTimeline(session.started_at, deriveDefaultEndIso(session))
      .then((res) => {
        if (!cancelled) setTimeline(res)
      })
      .catch((err) => {
        if (!cancelled) {
          setTimelineError(err instanceof Error ? err.message : 'Unable to fetch timeline')
        }
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, session])

  const segmentSignature = useMemo(
    () =>
      segments
        .map((s) => `${s.id}:${s.startedAt}:${s.endedAt}:${s.mode}:${s.activityType}:${s.routineName}`)
        .join('|'),
    [segments]
  )

  useEffect(() => {
    if (!isOpen || segments.length === 0) return
    const setLoading = (id: string, val: boolean) =>
      setMetricsLoadingById((prev) => ({ ...prev, [id]: val }))
    const setMetrics = (id: string, data: WorkoutMetrics) =>
      setMetricsById((prev) => ({ ...prev, [id]: data }))
    const setError = (id: string, msg: string | null) =>
      setMetricsErrorById((prev) => {
        if (msg === null) {
          const copy = { ...prev }
          delete copy[id]
          return copy
        }
        return { ...prev, [id]: msg }
      })

    const timer = window.setTimeout(() => {
      for (const seg of segments) previewSegmentMetrics(seg, setLoading, setMetrics, setError)
    }, 220)
    return () => window.clearTimeout(timer)
  }, [isOpen, segmentSignature])

  return {
    timeline,
    timelineLoading,
    timelineError,
    metricsById,
    metricsLoadingById,
    metricsErrorById,
  }
}
