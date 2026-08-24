import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { hashPassword, verifyPassword } from '../../utils/password.utils';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} from '../../utils/jwt.utils';
import type { LoginInput, RegisterInput } from './auth.schema';

const USER_FIELDS = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  avatarUrl: true,
  locale: true,
} as const;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

async function issueTokens(
  userId: string,
  role: string,
  deviceInfo?: string,
): Promise<AuthTokens> {
  const accessToken = signAccessToken({ sub: userId, role });
  const { token: refreshToken, expiresAt } = signRefreshToken(userId);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      deviceInfo: deviceInfo ?? null,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput, deviceInfo?: string) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      role: 'CUSTOMER', // staff & admin accounts are provisioned via admin panel
    },
    select: USER_FIELDS,
  });

  // Auto-login: hand back tokens immediately
  const tokens = await issueTokens(user.id, user.role, deviceInfo);
  return { user, ...tokens };
}

export async function login(input: LoginInput, deviceInfo?: string) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
  });

  // Same generic message for unknown email / wrong password / social-only account —
  // prevents attackers from probing which emails exist.
  if (!user || !user.passwordHash) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (user.status === 'BLOCKED') {
    throw ApiError.forbidden('This account has been blocked');
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const { passwordHash: _hash, ...safeUser } = user;
  const tokens = await issueTokens(user.id, user.role, deviceInfo);
  return { user: safeUser, ...tokens };
}

export async function refreshSession(oldRefreshToken: string, deviceInfo?: string) {
  const payload = verifyRefreshToken(oldRefreshToken);
  if (!payload) {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  const tokenHash = hashToken(oldRefreshToken);

  // NOTE: reuse/expiry handling happens OUTSIDE the transaction below —
  // throwing inside a Prisma $transaction rolls back its writes, which would
  // silently undo the "revoke every session" protection.
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored) {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  // Reuse detection: presenting an already-rotated token means it was likely
  // stolen → revoke every active session for this user immediately.
  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw ApiError.unauthorized('Session revoked — please log in again');
  }

  if (stored.expiresAt <= new Date()) {
    throw ApiError.unauthorized('Refresh token expired');
  }

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: USER_FIELDS,
  });
  if (!user || user.status === 'BLOCKED') {
    throw ApiError.forbidden('Account is unavailable');
  }

  // Rotation: revoke old + mint new atomically.
  // The revokedAt:null guard makes concurrent double-refresh safe —
  // whichever request loses the race gets a clean 401.
  const newRefreshToken = await prisma.$transaction(async (tx) => {
    const rotated = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotated.count === 0) {
      throw ApiError.unauthorized('Invalid refresh token');
    }

    const { token, expiresAt } = signRefreshToken(stored.userId);
    await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashToken(token),
        deviceInfo: deviceInfo ?? stored.deviceInfo,
        expiresAt,
      },
    });
    return token;
  });

  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  return { user, accessToken, refreshToken: newRefreshToken };
}

export async function logout(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  // Idempotent: no-op if token is unknown or already revoked.
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: USER_FIELDS,
  });
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  return user;
}
