import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import type { AuthenticatedUser } from '../../middleware/auth.middleware';
import type { CreateReviewInput, UpdateReviewInput } from './engagement.schema';

const REVIEW_SELECT = {
  id: true,
  rating: true,
  comment: true,
  staffReply: true,
  createdAt: true,
  customer: { select: { fullName: true } },
  staffProfile: { select: { user: { select: { fullName: true } } } },
  appointment: { select: { service: { select: { name: true } } } },
} as const;

type ReviewRow = {
  id: string;
  rating: number;
  comment: string | null;
  staffReply: string | null;
  createdAt: Date;
  customer: { fullName: string };
  staffProfile: { user: { fullName: string } };
  appointment: { service: { name: string } } | null;
};

function serialize(r: ReviewRow) {
  const firstName = r.customer.fullName.split(' ')[0] ?? r.customer.fullName;
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    staffReply: r.staffReply,
    createdAt: r.createdAt.toISOString(),
    customerFirstName: firstName,
    staffName: r.staffProfile.user.fullName,
    serviceName: r.appointment?.service.name ?? null,
  };
}

export async function createReview(userId: string, input: CreateReviewInput) {
  const apt = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: { customerId: true, staffProfileId: true, status: true },
  });
  if (!apt) throw ApiError.notFound('Appointment not found');
  if (apt.customerId !== userId) {
    throw ApiError.forbidden('You can only review your own visits');
  }
  if (apt.status !== 'COMPLETED') {
    throw ApiError.conflict('Only completed visits can be reviewed');
  }

  try {
    const created = await prisma.review.create({
      data: {
        appointmentId: input.appointmentId,
        customerId: userId,
        staffProfileId: apt.staffProfileId,
        rating: input.rating,
        comment: input.comment,
      },
      select: REVIEW_SELECT,
    });
    return serialize(created);
  } catch (err) {
    // Unique index on appointment_id — friendly message instead of raw P2002
    if ((err as { code?: string }).code === 'P2002') {
      throw ApiError.conflict('This visit has already been reviewed');
    }
    throw err;
  }
}

export async function updateOwnReview(userId: string, reviewId: string, input: UpdateReviewInput) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { customerId: true },
  });
  if (!review) throw ApiError.notFound('Review not found');
  if (review.customerId !== userId) throw ApiError.forbidden('Not your review');

  return prisma.review
    .update({
      where: { id: reviewId },
      data: { ...input, comment: input.comment ?? undefined },
      select: REVIEW_SELECT,
    })
    .then(serialize);
}

export async function deleteOwnReview(userId: string, reviewId: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { customerId: true },
  });
  if (!review) throw ApiError.notFound('Review not found');
  if (review.customerId !== userId) throw ApiError.forbidden('Not your review');

  await prisma.review.delete({ where: { id: reviewId } });
}

export async function replyToReview(actor: NonNullable<AuthenticatedUser>, reviewId: string, reply: string) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { staffProfileId: true },
  });
  if (!review) throw ApiError.notFound('Review not found');

  // A stylist may only reply to reviews about themselves; admins can reply anywhere.
  if (actor.role === 'STAFF' && review.staffProfileId !== actor.id) {
    throw ApiError.forbidden('You can only reply to your own reviews');
  }

  return prisma.review
    .update({ where: { id: reviewId }, data: { staffReply: reply }, select: REVIEW_SELECT })
    .then(serialize);
}

export async function listStaffReviews(staffId: string, page: number, pageSize: number) {
  const profile = await prisma.staffProfile.findUnique({
    where: { id: staffId },
    select: { isActive: true },
  });
  if (!profile || !profile.isActive) throw ApiError.notFound('Staff member not found');

  const [items, total] = await prisma.$transaction([
    prisma.review.findMany({
      where: { staffProfileId: staffId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: REVIEW_SELECT,
    }),
    prisma.review.count({ where: { staffProfileId: staffId } }),
  ]);

  return { items: items.map((r: (typeof items)[number]) => serialize(r)), total, page, pageSize };
}

/** Admin review queue across active and inactive stylists. */
export async function listAllReviews(page: number, pageSize: number) {
  const [items, total] = await prisma.$transaction([
    prisma.review.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: REVIEW_SELECT,
    }),
    prisma.review.count(),
  ]);
  return { items: items.map((r: (typeof items)[number]) => serialize(r)), total, page, pageSize };
}
