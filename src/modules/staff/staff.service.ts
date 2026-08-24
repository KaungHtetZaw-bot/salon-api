import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import { hashPassword } from '../../utils/password.utils';
import type {
  CreateStaffInput,
  UpdateStaffInput,
  WorkingHoursInput,
} from './staff.schema';

async function ratingsFor(staffIds: string[]) {
  if (staffIds.length === 0) return new Map<string, { avg: number | null; count: number }>();

  const grouped = await prisma.review.groupBy({
    by: ['staffProfileId'],
    where: { staffProfileId: { in: staffIds } },
    _avg: { rating: true },
    _count: { _all: true },
  });

  return new Map(
    grouped.map((g) => [
      g.staffProfileId,
      { avg: g._avg.rating, count: g._count._all },
    ]),
  );
}

// ────────────────────────── Public ──────────────────────────

export async function listStaff() {
  const profiles = await prisma.staffProfile.findMany({
    where: { isActive: true },
    orderBy: [{ isBookable: 'desc' }, { user: { fullName: 'asc' } }],
    select: {
      id: true,
      title: true,
      bio: true,
      isBookable: true,
      user: { select: { id: true, fullName: true, avatarUrl: true } },
      _count: { select: { portfolioItems: true } },
    },
  });

  const ratings = await ratingsFor(profiles.map((p) => p.id));

  return profiles.map((p) => ({
    id: p.id, // same as the underlying user id
    fullName: p.user.fullName,
    avatarUrl: p.user.avatarUrl,
    title: p.title,
    bio: p.bio,
    isBookable: p.isBookable,
    portfolioCount: p._count.portfolioItems,
    rating: ratings.get(p.id) ?? { avg: null, count: 0 },
  }));
}

export async function getStaff(id: string) {
  const profile = await prisma.staffProfile.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      bio: true,
      isBookable: true,
      isActive: true,
      user: { select: { id: true, fullName: true, avatarUrl: true } },
      services: {
        select: {
          customDuration: true,
          customPrice: true,
          service: {
            select: {
              id: true,
              name: true,
              description: true,
              basePrice: true,
              baseDurationMin: true,
              imageUrl: true,
            },
          },
        },
      },
    },
  });

  // Hidden stylists stay hidden (but keep a distinct message vs never-existed).
  if (!profile || !profile.isActive) throw ApiError.notFound('Staff member not found');

  const [ratings, portfolio] = await Promise.all([
    ratingsFor([profile.id]),
    prisma.portfolioItem.findMany({
      where: { staffProfileId: profile.id },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, imageUrl: true, caption: true, displayOrder: true },
    }),
  ]);

  return {
    id: profile.id,
    fullName: profile.user.fullName,
    avatarUrl: profile.user.avatarUrl,
    title: profile.title,
    bio: profile.bio,
    isBookable: profile.isBookable,
    rating: ratings.get(profile.id) ?? { avg: null, count: 0 },
    services: profile.services.map((link) => ({
      id: link.service.id,
      name: link.service.name,
      description: link.service.description,
      imageUrl: link.service.imageUrl,
      price: link.customPrice ?? link.service.basePrice,
      durationMin: link.customDuration ?? link.service.baseDurationMin,
    })),
    portfolio,
  };
}

export async function listPortfolio(staffId: string) {
  const profile = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    select: { isActive: true },
  });
  if (!profile || !profile.isActive) throw ApiError.notFound('Staff member not found');

  return prisma.portfolioItem.findMany({
    where: { staffProfileId: staffId },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, imageUrl: true, caption: true, displayOrder: true },
  });
}

// ────────────────────────── Admin ───────────────────────────

const ADMIN_STAFF_FIELDS = {
  id: true,
  title: true,
  bio: true,
  commissionRate: true,
  isBookable: true,
  hireDate: true,
  isActive: true,
  user: {
    select: { id: true, fullName: true, email: true, phone: true, status: true, avatarUrl: true },
  },
} as const;

export async function adminListStaff() {
  return prisma.staffProfile.findMany({
    orderBy: [{ isActive: 'desc' }, { user: { fullName: 'asc' } }],
    select: {
      ...ADMIN_STAFF_FIELDS,
      workingHours: {
        orderBy: { weekday: 'asc' },
        select: { weekday: true, startMinute: true, endMinute: true },
      },
    },
  });
}

export async function createStaff(input: CreateStaffInput) {
  const emailTaken = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (emailTaken) throw ApiError.conflict('An account with this email already exists');

  const { workingHours, ...userData } = input;

  // All-or-nothing: user row + profile + schedule succeed or fail together.
  const profile = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        fullName: userData.fullName,
        email: userData.email,
        phone: userData.phone,
        passwordHash: await hashPassword(userData.password),
        role: 'STAFF',
      },
    });

    const created = await tx.staffProfile.create({
      data: {
        id: user.id,
        title: userData.title,
        bio: userData.bio,
        commissionRate: userData.commissionRate,
      },
      select: ADMIN_STAFF_FIELDS,
    });

    if (workingHours?.length) {
      await tx.workingHours.createMany({
        data: workingHours.map((h) => ({ ...h, staffProfileId: user.id })),
      });
    }

    return created;
  });

  return profile;
}

export async function updateStaff(id: string, input: UpdateStaffInput) {
  const existing = await prisma.staffProfile.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Staff member not found');

  const { fullName, phone, ...profileFields } = input;

  return prisma.$transaction(async (tx) => {
    if (fullName !== undefined || phone !== undefined) {
      await tx.user.update({
        where: { id },
        data: {
          ...(fullName !== undefined ? { fullName } : {}),
          ...(phone !== undefined ? { phone: phone ?? null } : {}),
        },
      });
    }

    if (Object.keys(profileFields).length > 0) {
      await tx.staffProfile.update({ where: { id }, data: profileFields });
    }

    return tx.staffProfile.findUnique({ where: { id }, select: ADMIN_STAFF_FIELDS });
  });
}

export async function replaceWorkingHours(staffId: string, hours: WorkingHoursInput) {
  const existing = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Staff member not found');

  // Replace-all semantics — simplest correct model for weekly schedules.
  await prisma.$transaction([
    prisma.workingHours.deleteMany({ where: { staffProfileId: staffId } }),
    prisma.workingHours.createMany({
      data: hours.map((h) => ({ ...h, staffProfileId: staffId })),
    }),
  ]);

  return prisma.workingHours.findMany({
    where: { staffProfileId: staffId },
    orderBy: { weekday: 'asc' },
    select: { weekday: true, startMinute: true, endMinute: true },
  });
}

export async function addPortfolioItem(
  staffId: string,
  input: { imageUrl: string; caption?: string; serviceId?: string },
) {
  const existing = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Staff member not found');

  if (input.serviceId) {
    const svc = await prisma.service.findUnique({
      where: { id: input.serviceId },
      select: { id: true },
    });
    if (!svc) throw ApiError.notFound('Service not found');
  }

  return prisma.portfolioItem.create({
    data: { ...input, staffProfileId: staffId },
    select: { id: true, imageUrl: true, caption: true, displayOrder: true },
  });
}

export async function removePortfolioItem(itemId: string) {
  const existing = await prisma.portfolioItem.findUnique({
    where: { id: itemId },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound('Portfolio item not found');

  await prisma.portfolioItem.delete({ where: { id: itemId } });
}
