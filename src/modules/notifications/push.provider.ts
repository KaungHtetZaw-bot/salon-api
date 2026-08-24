import type { App as FirebaseApp } from 'firebase-admin/app';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../../config/env';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  sent: number;
  failedTokens: string[];
  simulated: boolean;
}

let firebaseApp: FirebaseApp | null = null;
let initAttempted = false;

/**
 * Real FCM when FIREBASE_SERVICE_ACCOUNT_JSON is configured;
 * otherwise a fully-functional simulated mode (payloads logged) so
 * development and tests never need Firebase credentials.
 */
function ensureFirebase(): FirebaseApp | null {
  if (initAttempted) return firebaseApp;
  initAttempted = true;

  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  try {
    const credentials =
      raw.trim().startsWith('{')
        ? JSON.parse(raw)
        : JSON.parse(require('fs').readFileSync(raw, 'utf8'));

    const existing = getApps().find((a) => a.name === 'salon-shop');
    firebaseApp = existing ?? initializeApp({ credential: cert(credentials) }, 'salon-shop');
    // eslint-disable-next-line no-console
    console.log('🔥 Firebase Admin initialized — real push enabled');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid FIREBASE_SERVICE_ACCOUNT_JSON — falling back to simulated push', err);
    firebaseApp = null;
  }
  return firebaseApp;
}

export function isRealPushEnabled(): boolean {
  return ensureFirebase() !== null;
}

/** Tokens that FCM reports as dead should be pruned by the caller. */
const UNREGISTERED_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export async function sendPush(tokens: string[], payload: PushPayload): Promise<PushResult> {
  if (tokens.length === 0) {
    return { sent: 0, failedTokens: [], simulated: false };
  }

  const app = ensureFirebase();
  if (!app) {
    // Simulated mode — visible in logs, keeps flows testable end-to-end.
    // eslint-disable-next-line no-console
    console.log(
      `[push:simulated] → ${tokens.length} device(s): "${payload.title}" | ${payload.body} | ${JSON.stringify(payload.data ?? {})}`,
    );
    return { sent: tokens.length, failedTokens: [], simulated: true };
  }

  const message = {
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
    tokens,
  };

  const response = await getMessaging(app).sendEachForMulticast(message);

  const failedTokens = response.responses
    .map((r, i) => ({ r, token: tokens[i]! }))
    .filter(({ r }) => !r.success && r.error && UNREGISTERED_ERRORS.has(r.error.code))
    .map(({ token }) => token);

  return { sent: response.successCount, failedTokens, simulated: false };
}
