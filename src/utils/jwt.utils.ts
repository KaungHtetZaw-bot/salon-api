import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string; // user id
  role: string;
}

export interface RefreshTokenPayload {
  sub: string; // user id
  jti: string; // unique token id, stored hashed in refresh_tokens
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
  });
}

export function signRefreshToken(userId: string): {
  token: string;
  jti: string;
  expiresAt: Date;
} {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, jti }, env.JWT_REFRESH_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { token, jti, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded === 'object' && decoded !== null && 'sub' in decoded && 'role' in decoded) {
      return { sub: String(decoded.sub), role: String(decoded.role) };
    }
    return null;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET);
    if (typeof decoded === 'object' && decoded !== null && 'sub' in decoded && 'jti' in decoded) {
      return { sub: String(decoded.sub), jti: String(decoded.jti) };
    }
    return null;
  } catch {
    return null;
  }
}

// Refresh tokens are stored hashed — a leaked DB dump yields no usable tokens.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
