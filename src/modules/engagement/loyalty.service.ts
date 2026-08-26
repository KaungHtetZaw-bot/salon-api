import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import type { AuthenticatedUser } from '../../middleware/auth.middleware';

export async function getBalance(customerId: string) {
  const [agg, cheapestReward] = await Promise.all([
    prisma.loyaltyTransaction.aggregate({
      where: { customerId },
      _sum: { points: true },
    }),
    prisma.reward.findFirst({
      where: { isActive: true },
      orderBy: { pointsCost: 'asc' },
      select: { name: true, pointsCost: true },
    }),
  ]);

  const balance = agg._sum.points ?? 0;

  let nextReward: { name: string; pointsCost: number; pointsRemaining: number } | null = null;
  if (cheapestReward && balance < cheapestReward.pointsCost) {
    nextReward = {
      name: cheapestReward.name,
      pointsCost: cheapestReward.pointsCost,
      pointsRemaining: cheapestReward.pointsCost - balance,
    };
  }

  return { balance, nextReward };
}

export async function getHistory(customerId: string, page: number, pageSize: number) {
  const [items, total] = await prisma.$transaction([
    prisma.loyaltyTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        points: true,
        type: true,
        description: true,
        createdAt: true,
      },
    }),
    prisma.loyaltyTransaction.count({ where: { customerId } }),
  ]);

  return {
    items: items.map((t: (typeof items)[number]) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

export async function listRewards() {
  const rewards = await prisma.reward.findMany({
    where: { isActive: true },
    orderBy: { pointsCost: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      pointsCost: true,
      discountPct: true,
      service: { select: { id: true, name: true } },
    },
  });

  return rewards.map((r: (typeof rewards)[number]) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    pointsCost: r.pointsCost,
    discountPct: r.discountPct,
    freeService: r.service ? { id: r.service.id, name: r.service.name } : null,
  }));
}

/**
 * Redeem a reward. Concurrency-safe: the touch on the customer's own row
 * takes a row lock inside the transaction, serializing parallel redemptions
 * so two phones can never spend the same points twice.
 */
export async function redeemReward(customerId: string, rewardId: string) {
  return prisma.$transaction(async (tx) => {
    const reward = await tx.reward.findFirst({
      where: { id: rewardId, isActive: true },
      include: { service: { select: { id: true, name: true } } },
    });
    if (!reward) throw ApiError.notFound('Reward not found or inactive');

    // Serialize concurrent redemptions for this customer
    await tx.user.update({
      where: { id: customerId },
      data: { updatedAt: new Date() },
    });

    const agg = await tx.loyaltyTransaction.aggregate({
      where: { customerId },
      _sum: { points: true },
    });
    const balance = agg._sum.points ?? 0;

    if (balance < reward.pointsCost) {
      throw ApiError.conflict(
        `Not enough points — you have ${balance}, this reward costs ${reward.pointsCost}`,
      );
    }

    const transaction = await tx.loyaltyTransaction.create({
      data: {
        customerId,
        points: -reward.pointsCost,
        type: 'REDEEMED',
        description: `Redeemed: ${reward.name}`,
      },
      select: { id: true, points: true },
    });

    const redemption = await tx.redemption.create({
      data: { customerId, rewardId },
    });

    return {
      voucherId: redemption.id,
      status: redemption.status,
      redeemedAt: redemption.redeemedAt.toISOString(),
      reward: {
        id: reward.id,
        name: reward.name,
        ...(reward.service ? { freeService: { id: reward.service.id, name: reward.service.name } } : {}),
        ...(reward.discountPct ? { discountPct: reward.discountPct } : {}),
      },
      pointsSpent: transaction.points,
      remainingBalance: balance - reward.pointsCost,
    };
  });
}

export async function myRedemptions(customerId: string, page: number, pageSize: number) {
  const [items, total] = await prisma.$transaction([
    prisma.redemption.findMany({
      where: { customerId },
      orderBy: { redeemedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        redeemedAt: true,
        usedAt: true,
        reward: { select: { id: true, name: true, pointsCost: true } },
      },
    }),
    prisma.redemption.count({ where: { customerId } }),
  ]);

  return {
    items: items.map((r: (typeof items)[number]) => ({
      ...r,
      redeemedAt: r.redeemedAt.toISOString(),
      usedAt: r.usedAt?.toISOString() ?? null,
    })),
    total,
    page,
    pageSize,
  };
}

export async function markVoucherUsed(_actor: NonNullable<AuthenticatedUser>, voucherId: string) {
  // Atomic gate — only the first staff member to scan wins.
  const result = await prisma.redemption.updateMany({
    where: { id: voucherId, status: 'ISSUED' },
    data: { status: 'USED', usedAt: new Date() },
  });
  if (result.count === 0) {
    throw ApiError.conflict('Voucher is not redeemable (already used or cancelled)');
  }

  const voucher = await prisma.redemption.findUnique({
    where: { id: voucherId },
    select: {
      id: true,
      status: true,
      usedAt: true,
      customer: { select: { fullName: true } },
      reward: { select: { name: true } },
    },
  });

  return {
    voucherId: voucher!.id,
    status: voucher!.status,
    usedAt: voucher!.usedAt!.toISOString(),
    customer: voucher!.customer.fullName,
    reward: voucher!.reward.name,
  };
}
