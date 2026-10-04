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

// The single in-progress workout, persisted so a reload/backgrounding can
// restore it. Only the "current" draft is kept — finishing the session removes it.
export interface DraftSession {
  id: string
  session: SessionPayload
  savedAt: number
}

class KratosDb extends Dexie {
  outbox!: Table<QueuedSession, string>
  drafts!: Table<DraftSession, string>

  constructor() {
    super('kratos')
    this.version(1).stores({
      outbox: 'id, queuedAt',
    })
    this.version(2).stores({
      drafts: 'id, savedAt',
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
