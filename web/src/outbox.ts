// The outbox. iOS has no Background Sync, so a flush happens while the app is
// open - on launch, on resume, and right after a set is logged.

import { SessionExpiredError } from '@yggdrasil-lab/ui'
import { api } from './api'
import { db, type QueuedSession } from './db'
import type { SessionPayload } from './types'
import { reportClientError } from './utils/telemetry'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function newId(): string {
  return crypto.randomUUID()
}

export function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && UUID_REGEX.test(val)
}

export function sanitizeSessionPayload(payload: SessionPayload): SessionPayload {
  return {
    ...payload,
    routine_id: isValidUuid(payload.routine_id) ? payload.routine_id : null,
    items: (payload.items ?? []).filter((item) => isValidUuid(item.exercise_id)),
  }
}

export async function enqueue(payload: SessionPayload): Promise<void> {
  const sanitized = sanitizeSessionPayload(payload)
  await db.outbox.put({
    id: sanitized.id,
    payload: sanitized,
    queuedAt: Date.now(),
    attempts: 0,
  })
}

/** Pushes every queued session. Returns how many are still pending. */
export async function flush(): Promise<number> {
  const entries = await db.outbox.orderBy('queuedAt').toArray()
  for (const entry of entries) {
    const sanitized = sanitizeSessionPayload(entry.payload)
    try {
      await api.putSession(sanitized)
      await db.outbox.delete(entry.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof SessionExpiredError) {
        await db.outbox.update(entry.id, {
          lastError: message,
        })
        throw error
      }
      const nextAttempts = entry.attempts + 1
      const isClientValidationError = /^(400|422)\b/.test(message)
      if (isClientValidationError && nextAttempts >= 3) {
        await db.outbox.delete(entry.id)
        void reportClientError(error, {
          source: 'outbox_poison_evicted',
          sessionId: entry.id,
          attempts: nextAttempts,
        })
      } else {
        await db.outbox.update(entry.id, {
          attempts: nextAttempts,
          lastError: message,
        })
      }
    }
  }
  return db.outbox.count()
}

export async function pending(): Promise<QueuedSession[]> {
  return db.outbox.orderBy('queuedAt').toArray()
}
