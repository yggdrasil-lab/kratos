import type { ClientErrorPayload } from '../types'

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'
const MAX_RECENT_ERRORS = 25
const recentErrorKeys = new Set<string>()

export async function reportClientError(
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  try {
    let message = 'Unknown error'
    let stack: string | undefined
    let errorType = 'Error'

    if (error instanceof Error) {
      message = error.message || error.name
      stack = error.stack
      errorType = error.name || 'Error'
    } else if (typeof error === 'string') {
      message = error
    } else if (error && typeof error === 'object') {
      const candidate = error as { message?: string; name?: string; stack?: string }
      message = candidate.message || JSON.stringify(error)
      stack = candidate.stack
      errorType = candidate.name || 'Object'
    }

    const source = (context?.source as string) || undefined
    const lineno = typeof context?.lineno === 'number' ? context.lineno : undefined
    const colno = typeof context?.colno === 'number' ? context.colno : undefined
    const resolvedType = (context?.error_type as string) || errorType

    const dedupeKey = `${message}:${source || ''}:${lineno || 0}:${resolvedType}`
    if (recentErrorKeys.has(dedupeKey)) {
      return
    }
    recentErrorKeys.add(dedupeKey)
    if (recentErrorKeys.size > MAX_RECENT_ERRORS) {
      const first = recentErrorKeys.values().next().value
      if (first) recentErrorKeys.delete(first)
    }

    const payload: ClientErrorPayload = {
      message,
      error_type: resolvedType,
      source,
      lineno,
      colno,
      stack,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      timestamp: new Date().toISOString(),
      extra: context || {},
    }

    if (typeof fetch !== 'undefined') {
      await fetch(`${BASE}/client-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Do not throw or loop if telemetry endpoint is unreachable
      })
    }
  } catch {
    // Guard against any failure in error reporter itself
  }
}

let isInitialized = false

export function initGlobalErrorReporter(): void {
  if (isInitialized || typeof window === 'undefined') return
  isInitialized = true

  window.addEventListener('error', (event: ErrorEvent) => {
    void reportClientError(event.error || event.message, {
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error_type: 'WindowError',
    })
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    void reportClientError(event.reason, {
      error_type: 'UnhandledRejection',
    })
  })
}
