import { useEffect, useState } from 'react'

import { api } from './api'
import { flush, pending } from './outbox'
import type { Exercise } from './types'

type Status = { kind: 'idle' | 'busy' | 'error'; message?: string }

export function App() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [queued, setQueued] = useState(0)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  async function refresh() {
    setQueued((await pending()).length)
    try {
      setExercises(await api.exercises())
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function sync() {
    setStatus({ kind: 'busy', message: 'Syncing…' })
    const left = await flush()
    setQueued(left)
    setStatus({
      kind: 'idle',
      message: left === 0 ? 'Up to date.' : `${left} still queued.`,
    })
  }

  // iOS has no Background Sync, so flush on launch and whenever the app is
  // brought back to the foreground.
  useEffect(() => {
    void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return (
    <main>
      <header>
        <h1>Kratos</h1>
        <p>
          {queued === 0 ? 'Nothing queued.' : `${queued} session(s) queued.`}
        </p>
        <button type="button" onClick={sync} disabled={status.kind === 'busy'}>
          Sync now
        </button>
        {status.message ? <p role="status">{status.message}</p> : null}
      </header>

      <section>
        <h2>Catalogue</h2>
        {status.kind === 'error' ? (
          <p role="alert">
            Could not reach the API. The app still works offline; sessions are
            kept on the device until the next sync.
          </p>
        ) : null}
        {exercises.length === 0 ? (
          <p>No exercises yet.</p>
        ) : (
          <ul>
            {exercises.map((exercise) => (
              <li key={exercise.id}>
                <strong>{exercise.name}</strong>{' '}
                <small>
                  {exercise.tracking.replace('_', ' / ')}
                  {exercise.primary_muscles.length
                    ? ` — ${exercise.primary_muscles.join(', ')}`
                    : ''}
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
