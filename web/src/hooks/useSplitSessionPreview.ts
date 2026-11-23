import { useEffect, useRef, useState } from 'react'
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

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

function previewSegmentMetrics(
  seg: SplitSegmentDraft,
  signal: AbortSignal,
  isStale: () => boolean,
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
    .getWorkoutMetrics(
      {
        started_at: seg.startedAt,
        ended_at: seg.endedAt,
        activity_type: activityParam,
        classification: activityParam,
        routine_name: seg.routineName || undefined,
      },
      signal
    )
    .then((data) => {
      if (!isStale()) setMetrics(seg.id, data)
    })
    .catch((err) => {
      if (!isStale() && !isAbortError(err)) {
        setError(seg.id, err instanceof Error ? err.message : 'Eir preview unavailable')
      }
    })
    .finally(() => {
      if (!isStale()) setLoading(seg.id, false)
    })
}

function useSplitTimelineFetch(isOpen: boolean, session: SessionPayload | null, onResetMetrics: () => void) {
  const [timeline, setTimeline] = useState<WorkoutTimelineResponse | null>(null)
  const [timelineLoading, setTimelineLoading] = useState<boolean>(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !session) return
    const controller = new AbortController()
    let cancelled = false
    onResetMetrics()
    setTimeline(null)
    setTimelineError(null)
    setTimelineLoading(true)

    void api
      .getWorkoutTimeline(session.started_at, deriveDefaultEndIso(session), controller.signal)
      .then((res) => { if (!cancelled) setTimeline(res) })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) {
          setTimelineError(err instanceof Error ? err.message : 'Unable to fetch timeline')
        }
      })
      .finally(() => { if (!cancelled) setTimelineLoading(false) })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [isOpen, session])

  return { timeline, timelineLoading, timelineError }
}

function useSegmentMetricsPreview(
  isOpen: boolean,
  segments: SplitSegmentDraft[],
  setMetricsById: React.Dispatch<React.SetStateAction<Record<string, WorkoutMetrics>>>,
  setMetricsErrorById: React.Dispatch<React.SetStateAction<Record<string, string>>>
) {
  const [metricsLoadingById, setMetricsLoadingById] = useState<Record<string, boolean>>({})
  const requestSeqRef = useRef<number>(0)

  useEffect(() => {
    if (!isOpen || segments.length === 0) return
    const controller = new AbortController()
    let cancelled = false
    const seq = ++requestSeqRef.current
    const isStale = () => cancelled || seq !== requestSeqRef.current
    const setLoading = (id: string, val: boolean) =>
      setMetricsLoadingById((prev) => ({ ...prev, [id]: val }))
    const setMetrics = (id: string, data: WorkoutMetrics) =>
      setMetricsById((prev) => ({ ...prev, [id]: data }))
    const setError = (id: string, msg: string | null) =>
      setMetricsErrorById((prev) => {
        if (msg !== null) return { ...prev, [id]: msg }
        const copy = { ...prev }
        delete copy[id]
        return copy
      })

    const timer = window.setTimeout(() => {
      for (const seg of segments) {
        previewSegmentMetrics(seg, controller.signal, isStale, setLoading, setMetrics, setError)
      }
    }, 220)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [isOpen, segments, setMetricsById, setMetricsErrorById])

  return metricsLoadingById
}

/**
 * Fetches Eir 5-min HR/step timeline on open and debounces per-segment workout-metrics previews
 * with AbortController and sequence guards so stale responses never overwrite newer state.
 */
export function useSplitSessionPreview(
  isOpen: boolean,
  session: SessionPayload | null,
  segments: SplitSegmentDraft[]
): SplitPreviewState {
  const [metricsById, setMetricsById] = useState<Record<string, WorkoutMetrics>>({})
  const [metricsErrorById, setMetricsErrorById] = useState<Record<string, string>>({})

  const onResetMetrics = () => {
    setMetricsById({})
    setMetricsErrorById({})
  }
  const { timeline, timelineLoading, timelineError } = useSplitTimelineFetch(
    isOpen,
    session,
    onResetMetrics
  )
  const metricsLoadingById = useSegmentMetricsPreview(
    isOpen,
    segments,
    setMetricsById,
    setMetricsErrorById
  )

  return {
    timeline,
    timelineLoading,
    timelineError,
    metricsById,
    metricsLoadingById,
    metricsErrorById,
  }
}
