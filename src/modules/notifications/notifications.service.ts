import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import type { Platform } from '../../generated/prisma/client';

export async function registerDevice(
  userId: string,
  input: { fcmToken: string; platform: Platform },
) {
  // Upsert by token — reinstalling the app or account switches keep one row.
  const device = await prisma.deviceToken.upsert({
    where: { fcmToken: input.fcmToken },
    update: {
      userId,
      platform: input.platform,
      lastUsedAt: new Date(),
    },
    create: {
      userId,
      fcmToken: input.fcmToken,
      platform: input.platform,
    },
    select: { id: true, platform: true, lastUsedAt: true },
  });

  return device;
}

export async function removeDevice(userId: string, fcmToken: string) {
  const result = await prisma.deviceToken.deleteMany({
    where: { fcmToken, userId }, // ownership check baked in
  });
  if (result.count === 0) throw ApiError.notFound('Device not found');
}

export async function listDevices(userId: string) {
  return prisma.deviceToken.findMany({
    where: { userId },
    orderBy: { lastUsedAt: 'desc' },
    select: { id: true, platform: true, lastUsedAt: true },
  });
}

export async function listNotifications(
  userId: string,
  page: number,
  pageSize: number,
) {
  const [items, total, unread] = await prisma.$transaction([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    items: items.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      data: n.data,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    total,
    unreadCount: unread,
    page,
    pageSize,
  };
}

export async function markRead(userId: string, notificationId: string) {
  const existing = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Notification not found');

  return prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { markedRead: result.count };
}
