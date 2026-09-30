// On-device store: sessions are written here first and pushed when a connection
// exists. Dexie over IndexedDB, per the accepted stack.

import Dexie, { type Table } from 'dexie'
import type { SessionPayload } from './types'

export interface QueuedSession {
  id: string
  payload: SessionPayload
  queuedAt: number
  attempts: number
  lastError?: string
}

class KratosDb extends Dexie {
  outbox!: Table<QueuedSession, string>

  constructor() {
    super('kratos')
    this.version(1).stores({
      outbox: 'id, queuedAt',
    })
  }
}

export const db = new KratosDb()

// iOS grants persistence by heuristic, and installation counts in the app's
// favour — but ask anyway rather than assume the heuristic lands.
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}
