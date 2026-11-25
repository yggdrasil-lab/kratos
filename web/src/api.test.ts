import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, isKratosApiError, KratosApiError, SessionExpiredError } from './api'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, statusText: string, detail: string): Response {
  return new Response(detail, {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  })
}

describe('api transport and fail-loud error handling', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('throws KratosApiError with status and path on non-OK JSON responses', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(502, 'Bad Gateway', 'Eir upstream down'))

    const caught = await api.sessions().catch((err: unknown) => err)
    expect(isKratosApiError(caught)).toBe(true)
    expect(caught).toBeInstanceOf(KratosApiError)
    if (isKratosApiError(caught)) {
      expect(caught.status).toBe(502)
      expect(caught.statusText).toBe('Bad Gateway')
      expect(caught.detail).toBe('Eir upstream down')
      expect(caught.path).toBe('/sessions?limit=50&offset=0')
    }
  })

  it('returns null ONLY on 404 for nullable read endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(404, 'Not Found', 'No weekly plan'))
      .mockResolvedValueOnce(errorResponse(404, 'Not Found', 'No biometrics'))
      .mockResolvedValueOnce(errorResponse(404, 'Not Found', 'No fasting rec'))
      .mockResolvedValueOnce(errorResponse(404, 'Not Found', 'No workout rec'))

    await expect(api.getWeeklyPlan('2026-W47')).resolves.toBeNull()
    await expect(api.getBiometricsToday()).resolves.toBeNull()
    await expect(api.getFastingRecommendation('2026-11-25')).resolves.toBeNull()
    await expect(api.getWorkoutRecommendation('2026-11-25')).resolves.toBeNull()
  })

  it('rethrows 5xx, 422, network errors, and SessionExpiredError from nullable read endpoints', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error', 'DB failure'))
    await expect(api.getWeeklyPlan('2026-W47')).rejects.toMatchObject({
      name: 'KratosApiError',
      status: 500,
    })

    fetchMock.mockResolvedValueOnce(errorResponse(502, 'Bad Gateway', 'Eir unreachable'))
    await expect(api.getBiometricsToday()).rejects.toMatchObject({
      name: 'KratosApiError',
      status: 502,
    })

    fetchMock.mockResolvedValueOnce(errorResponse(422, 'Unprocessable Entity', 'Bad date'))
    await expect(api.getFastingRecommendation('invalid')).rejects.toMatchObject({
      name: 'KratosApiError',
      status: 422,
    })

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api.getWorkoutRecommendation()).rejects.toThrow('Failed to fetch')

    fetchMock.mockResolvedValueOnce(
      new Response('<html>Login</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    )
    await expect(api.getBiometricsToday()).rejects.toBeInstanceOf(SessionExpiredError)
  })

  it('fails loudly on synthesis endpoints instead of returning null', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503, 'Service Unavailable', 'Muninn offline'))
    await expect(api.synthesizeFastingRecommendation('lunch at 1pm', '2026-11-25')).rejects.toMatchObject({
      name: 'KratosApiError',
      status: 503,
    })

    fetchMock.mockRejectedValueOnce(new TypeError('Network timeout'))
    await expect(api.synthesizeWorkoutRecommendation('shoulder sore', '2026-11-25')).rejects.toThrow(
      'Network timeout'
    )
  })

  it('fails loudly on fasting check-in and workout feedback writes', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error', 'Write failed'))
    await expect(
      api.saveFastingCheckIn({
        id: 'fc-1',
        date: '2026-11-25',
        target_window: '14:10',
        adherence: 'completed',
        logged_at: '2026-11-25T10:30:00Z',
      })
    ).rejects.toMatchObject({ name: 'KratosApiError', status: 500 })

    fetchMock.mockResolvedValueOnce(errorResponse(502, 'Bad Gateway', 'Eir timeout'))
    await expect(
      api.saveWorkoutFeedback({
        date: '2026-11-25',
        effort_rating: 'optimal',
      })
    ).rejects.toMatchObject({ name: 'KratosApiError', status: 502 })
  })

  it('returns parsed data on 200 and keeps reportClientError best-effort', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        date: '2026-11-25',
        readiness: { tier: 'optimal', label: 'High Readiness', message: 'Ready' },
      })
    )
    const bio = await api.getBiometricsToday()
    expect(bio?.readiness?.tier).toBe('optimal')

    fetchMock.mockRejectedValueOnce(new Error('Telemetry endpoint down'))
    await expect(api.reportClientError({ message: 'UI error' })).resolves.toBeUndefined()
  })
})
