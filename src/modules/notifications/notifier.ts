import { prisma } from '../../config/prisma';
import { sendPush, type PushPayload } from './push.provider';

interface NotifyInput {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Log the notification for the in-app center AND fan out a push to every
 * registered device. Never throws — notification failures must not break
 * the business operation that triggered them.
 */
export async function notifyUser(userId: string, payload: NotifyInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId,
        title: payload.title,
        body: payload.body,
        ...(payload.data ? { data: payload.data } : {}),
      },
    });

    const devices = await prisma.deviceToken.findMany({
      where: { userId },
      select: { fcmToken: true },
    });
    const tokens = devices.map((d) => d.fcmToken);

    if (tokens.length > 0) {
      const result = await sendPush(tokens, payload);
      if (result.failedTokens.length > 0) {
        // Prune dead tokens so future sends stay fast
        await prisma.deviceToken.deleteMany({
          where: { fcmToken: { in: result.failedTokens } },
        });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notifier] failed to deliver notification', err);
  }
}

/** Fire-and-forget wrapper for use inside request handlers. */
export function notifyUserAsync(userId: string, payload: NotifyInput): void {
  void notifyUser(userId, payload);
}

export function formatDateTime(d: Date): string {
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type { PushPayload };
