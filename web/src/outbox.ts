// The outbox. iOS has no Background Sync, so a flush happens while the app is
// open — on launch, on resume, and right after a set is logged.

import { api } from './api'
import { db, type QueuedSession } from './db'
import type { SessionPayload } from './types'

export function newId(): string {
  return crypto.randomUUID()
}

export async function enqueue(payload: SessionPayload): Promise<void> {
  await db.outbox.put({
    id: payload.id,
    payload,
    queuedAt: Date.now(),
    attempts: 0,
  })
}

/** Pushes every queued session. Returns how many are still pending. */
export async function flush(): Promise<number> {
  const pending = await db.outbox.orderBy('queuedAt').toArray()
  for (const entry of pending) {
    try {
      await api.putSession(entry.payload)
      await db.outbox.delete(entry.id)
    } catch (error) {
      await db.outbox.update(entry.id, {
        attempts: entry.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return db.outbox.count()
}

export async function pending(): Promise<QueuedSession[]> {
  return db.outbox.orderBy('queuedAt').toArray()
}
