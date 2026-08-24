import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import type { AdjustPointsInput, CreateRewardInput, UpdateRewardInput } from './engagement.schema';

// ─────────────────── Manual point adjustments ───────────────────

export async function adjustPoints(input: AdjustPointsInput) {
  const customer = await prisma.user.findUnique({
    where: { id: input.customerId },
    select: { id: true, fullName: true, role: true },
  });
  if (!customer) throw ApiError.notFound('Customer not found');

  const [transaction] = await prisma.$transaction([
    prisma.loyaltyTransaction.create({
      data: {
        customerId: input.customerId,
        points: input.points,
        type: 'ADJUSTED',
        description: input.description ?? 'Manual adjustment by admin',
      },
    }),
    // Keep the user's row warm — harmless, but also useful as an audit touchpoint.
    prisma.user.update({
      where: { id: input.customerId },
      data: { updatedAt: new Date() },
    }),
  ]);

  const agg = await prisma.loyaltyTransaction.aggregate({
    where: { customerId: input.customerId },
    _sum: { points: true },
  });

  return {
    transactionId: transaction.id,
    pointsApplied: input.points,
    newBalance: agg._sum.points ?? 0,
  };
}

// ─────────────────────── Rewards CRUD ──────────────────────────

const REWARD_FIELDS = {
  id: true,
  name: true,
  description: true,
  pointsCost: true,
  serviceId: true,
  discountPct: true,
  isActive: true,
} as const;

export async function adminListRewards() {
  return prisma.reward.findMany({
    orderBy: [{ isActive: 'desc' }, { pointsCost: 'asc' }],
    select: REWARD_FIELDS,
  });
}

export async function createReward(input: CreateRewardInput) {
  if (input.serviceId) {
    const svc = await prisma.service.findUnique({
      where: { id: input.serviceId },
      select: { id: true },
    });
    if (!svc) throw ApiError.notFound('Service not found');
  }

  return prisma.reward.create({ data: input, select: REWARD_FIELDS });
}

export async function updateReward(id: string, input: UpdateRewardInput) {
  const reward = await prisma.reward.findUnique({ where: { id }, select: { id: true } });
  if (!reward) throw ApiError.notFound('Reward not found');

  return prisma.reward.update({ where: { id }, data: input, select: REWARD_FIELDS });
}

// Soft delete — historical redemptions keep pointing at the reward row.
export async function deactivateReward(id: string) {
  const reward = await prisma.reward.findUnique({ where: { id }, select: { id: true } });
  if (!reward) throw ApiError.notFound('Reward not found');

  return prisma.reward.update({
    where: { id },
    data: { isActive: false },
    select: REWARD_FIELDS,
  });
}
