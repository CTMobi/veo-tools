import { describe, it, expect, vi, beforeEach } from 'vitest'

const getClientMock = vi.fn()
const getAccessTokenMock = vi.fn()
const GoogleAuthMock = vi.fn(function () {
  return { getClient: () => getClientMock() }
})

vi.mock('google-auth-library', () => ({
  GoogleAuth: GoogleAuthMock,
}))

beforeEach(() => {
  vi.resetModules()
  GoogleAuthMock.mockClear()
  getClientMock.mockReset()
  getAccessTokenMock.mockReset()
  getClientMock.mockResolvedValue({ getAccessToken: () => getAccessTokenMock() })
})

describe('getAccessToken', () => {
  it('returns the token issued by the underlying client', async () => {
    getAccessTokenMock.mockResolvedValue({ token: 'abc-123' })
    const { getAccessToken } = await import('@veo-core/auth')
    await expect(getAccessToken()).resolves.toBe('abc-123')
  })

  it('throws a guidance message when the client returns no token', async () => {
    getAccessTokenMock.mockResolvedValue({ token: undefined })
    const { getAccessToken } = await import('@veo-core/auth')
    await expect(getAccessToken()).rejects.toThrow(/no access token/i)
  })

  it('constructs GoogleAuth with the cloud-platform scope', async () => {
    getAccessTokenMock.mockResolvedValue({ token: 'ok' })
    const { getAccessToken } = await import('@veo-core/auth')
    await getAccessToken()
    expect(GoogleAuthMock).toHaveBeenCalledTimes(1)
    const ctorArg = GoogleAuthMock.mock.calls[0]?.[0] as { scopes?: string[] }
    expect(ctorArg?.scopes).toEqual(['https://www.googleapis.com/auth/cloud-platform'])
  })
})
