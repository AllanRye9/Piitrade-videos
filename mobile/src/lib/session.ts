import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';

/**
 * Identity on this backend is the X-Session-Id header. A fresh install is
 * a *guest* (random id, no account email); logging in adopts the
 * account's canonical session id. The id is effectively a credential, so
 * it lives in the OS keychain/keystore (SecureStore), with an in-memory
 * copy so request() can read it synchronously.
 */
const SESSION_KEY = 'piitrade_session_id';
const EMAIL_KEY = 'piitrade_account_email';

let sessionId: string | null = null;
let accountEmail: string | null = null;
let ready = false;

export async function bootstrapSession(): Promise<void> {
  if (ready) return;
  try {
    sessionId = await SecureStore.getItemAsync(SESSION_KEY);
    accountEmail = await SecureStore.getItemAsync(EMAIL_KEY);
  } catch {
    // Keystore unavailable — fall through to an in-memory guest session.
  }
  if (!sessionId) {
    sessionId = randomUUID();
    SecureStore.setItemAsync(SESSION_KEY, sessionId).catch(() => {});
  }
  ready = true;
}

export function getSessionId(): string {
  if (!sessionId) {
    sessionId = randomUUID();
    SecureStore.setItemAsync(SESSION_KEY, sessionId).catch(() => {});
  }
  return sessionId;
}

export function setSessionId(id: string) {
  sessionId = id;
  SecureStore.setItemAsync(SESSION_KEY, id).catch(() => {});
}

/** Starts a brand-new unlinked guest session — used by sign-out so the device stops being the old account. */
export function resetSessionId(): string {
  const id = randomUUID();
  setSessionId(id);
  return id;
}

export function getAccountEmail(): string | null {
  return accountEmail;
}

export function setAccountEmail(email: string | null) {
  accountEmail = email;
  if (email) SecureStore.setItemAsync(EMAIL_KEY, email).catch(() => {});
  else SecureStore.deleteItemAsync(EMAIL_KEY).catch(() => {});
}
