import { prisma } from '../../config/prisma';
import { ApiError } from '../../utils/ApiError';
import type {
  CreateCategoryInput,
  CreateServiceInput,
  UpdateCategoryInput,
  UpdateServiceInput,
} from './catalog.schema';

const SERVICE_PUBLIC_FIELDS = {
  id: true,
  name: true,
  description: true,
  basePrice: true,
  baseDurationMin: true,
  imageUrl: true,
  isActive: true,
  category: { select: { id: true, name: true } },
} as const;

// ────────────────────────── Public ──────────────────────────

export async function listCategories() {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' },
    select: {
      id: true,
      name: true,
      displayOrder: true,
      services: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
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
  });
}

export async function listServices(categoryId?: string) {
  return prisma.service.findMany({
    where: { isActive: true, ...(categoryId ? { categoryId } : {}) },
    orderBy: [{ category: { displayOrder: 'asc' } }, { name: 'asc' }],
    select: SERVICE_PUBLIC_FIELDS,
  });
}

// ────────────────────────── Admin ───────────────────────────

export async function createCategory(input: CreateCategoryInput) {
  return prisma.category.create({ data: input });
}

export async function updateCategory(id: string, input: UpdateCategoryInput) {
  const existing = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Category not found');

  return prisma.category.update({ where: { id }, data: input });
}

// Soft delete — historical services/appointments keep their reference intact.
export async function deactivateCategory(id: string) {
  const existing = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Category not found');

  const [category] = await prisma.$transaction([
    prisma.category.update({ where: { id }, data: { isActive: false } }),
    // Hiding a category hides its services too — otherwise orphaned active
    // services would still surface in the customer app.
    prisma.service.updateMany({ where: { categoryId: id }, data: { isActive: false } }),
  ]);
  return category;
}

export async function adminListServices() {
  return prisma.service.findMany({
    orderBy: [{ category: { displayOrder: 'asc' } }, { name: 'asc' }],
    select: SERVICE_PUBLIC_FIELDS,
  });
}

export async function createService(input: CreateServiceInput) {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { isActive: true },
  });
  if (!category) throw ApiError.notFound('Category not found');

  return prisma.service.create({
    data: {
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      basePrice: input.basePrice,
      baseDurationMin: input.baseDurationMin,
      imageUrl: input.imageUrl,
    },
    select: SERVICE_PUBLIC_FIELDS,
  });
}

export async function updateService(id: string, input: UpdateServiceInput) {
  const existing = await prisma.service.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Service not found');

  if (input.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });
    if (!category) throw ApiError.notFound('Target category not found');
  }

  return prisma.service.update({
    where: { id },
    data: input,
    select: SERVICE_PUBLIC_FIELDS,
  });
}

export async function deactivateService(id: string) {
  const existing = await prisma.service.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw ApiError.notFound('Service not found');

  return prisma.service.update({ where: { id }, data: { isActive: false } });
}
