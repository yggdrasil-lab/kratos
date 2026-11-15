import {
  initGlobalErrorReporter as initSharedGlobalErrorReporter,
  reportClientError as reportSharedClientError,
  type ClientErrorPayload,
  type TelemetryOptions,
} from '@yggdrasil-lab/ui'

export type { ClientErrorPayload, TelemetryOptions }

const BASE = import.meta.env.VITE_API_BASE_URL || '/api'
const ENDPOINT = `${BASE}/client-errors`

/**
 * Reports a client-side exception to the Kratos backend telemetry endpoint
 * using shared deduplication from @yggdrasil-lab/ui.
 */
export function reportClientError(
  error: unknown,
  context?: Record<string, unknown>,
  options?: TelemetryOptions
): Promise<void> {
  return reportSharedClientError(error, context, {
    endpoint: ENDPOINT,
    ...options,
  })
}

/**
 * Registers global window error and unhandledrejection listeners targeting Kratos telemetry.
 */
export function initGlobalErrorReporter(options?: TelemetryOptions): void {
  initSharedGlobalErrorReporter({
    endpoint: ENDPOINT,
    ...options,
  })
}
