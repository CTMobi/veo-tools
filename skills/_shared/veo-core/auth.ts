// auth.ts — OAuth token issuance via google-auth-library.
// Supports Service Accounts, ADC, Workload Identity natively (no gcloud CLI shell-out).
import { GoogleAuth } from 'google-auth-library'

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform']

let cachedAuth: GoogleAuth | undefined

export async function getAccessToken(): Promise<string> {
  if (!cachedAuth) cachedAuth = new GoogleAuth({ scopes: SCOPES })
  const client = await cachedAuth.getClient()
  const tokenResponse = await client.getAccessToken()
  if (!tokenResponse.token) {
    throw new Error('google-auth-library returned no access token. Check GOOGLE_APPLICATION_CREDENTIALS / ADC.')
  }
  return tokenResponse.token
}
