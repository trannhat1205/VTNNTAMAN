import type { IncomingMessage, ServerResponse } from 'node:http';

export interface VerifiedFirebaseAuth {
  ok: true;
  uid: string;
  email: string;
  emailVerified: boolean;
  isPrimaryAdmin: boolean;
  effectiveAccountId: string;
  idToken: string;
}

export interface FailedFirebaseAuth {
  ok: false;
  status: 401;
  error: string;
}

export type FirebaseAuthCheckResult = VerifiedFirebaseAuth | FailedFirebaseAuth;

export const ALLOWED_GEMINI_ORIGINS: Set<string>;
export function applyGeminiCors(req: IncomingMessage, res: ServerResponse): void;
export function loadDotEnvIntoProcess(baseDir: string): void;
export function verifyFirebaseIdToken(
  authHeader: string | undefined,
  options?: { certs?: Record<string, string>; nowSec?: number }
): Promise<FirebaseAuthCheckResult>;
export function fetchVerifiedBonusTokens(
  effectiveAccountId: string,
  idToken: string,
  todayVn: string,
  options?: { bypassCache?: boolean; fetchImpl?: typeof fetch }
): Promise<number>;
