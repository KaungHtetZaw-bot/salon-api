/* eslint-disable no-console */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const hash = (plain: string) => bcrypt.hash(plain, 10);

function nextMondayAt(hour: number): Date {
  const d = new Date();
  const diff = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function yesterdayAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main(): Promise<void> {
  console.log('🌱 Seeding Salon Shop database…');

  // ── Salon settings (singleton) ──────────────────────────────
  await prisma.salonSetting.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      salonName: 'Salon Shop',
      cancellationWindowHrs: 2,
      loyaltyPointsPerVisit: 10,
      slotBufferMinutes: 15,
      openingHours: [
        { weekday: 0, startMinute: null, endMinute: null }, // Sunday closed
        ...[1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          startMinute: 540,
          endMinute: 1080,
        })),
      ],
    },
  });
  console.log('✅ Salon settings');

  // ── Users ───────────────────────────────────────────────────
  const [admin, maria, aisha, lena, sara] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'admin@salonshop.app' },
      update: {},
      create: {
        fullName: 'Salon Owner',
        email: 'admin@salonshop.app',
        passwordHash: await hash('Admin123!'),
        role: 'ADMIN',
      },
    }),
    prisma.user.upsert({
      where: { email: 'maria@salonshop.app' },
      update: {},
      create: {
        fullName: 'Maria Chen',
        email: 'maria@salonshop.app',
        passwordHash: await hash('Stylist123!'),
        role: 'STAFF',
      },
    }),
    prisma.user.upsert({
      where: { email: 'aisha@salonshop.app' },
      update: {},
      create: {
        fullName: 'Aisha Patel',
        email: 'aisha@salonshop.app',
        passwordHash: await hash('Stylist123!'),
        role: 'STAFF',
      },
    }),
    prisma.user.upsert({
      where: { email: 'lena@salonshop.app' },
      update: {},
      create: {
        fullName: 'Lena Kim',
        email: 'lena@salonshop.app',
        passwordHash: await hash('Stylist123!'),
        role: 'STAFF',
      },
    }),
    prisma.user.upsert({
      where: { email: 'sara@example.com' },
      update: {},
      create: {
        fullName: 'Sara Johnson',
        email: 'sara@example.com',
        phone: '+15550100234',
        passwordHash: await hash('Customer123!'),
        role: 'CUSTOMER',
      },
    }),
  ]);
  console.log(`✅ Users (admin: ${admin.email}, staff x3, customer: ${sara.email})`);

  // ── Staff profiles ──────────────────────────────────────────
  await Promise.all([
    prisma.staffProfile.upsert({
      where: { id: maria.id },
      update: {},
      create: {
        id: maria.id,
        title: 'Senior Hair Stylist',
        bio: '12 years of precision cutting and styling. Specialist in layered cuts.',
        commissionRate: 40,
        hireDate: new Date('2022-03-01'),
      },
    }),
    prisma.staffProfile.upsert({
      where: { id: aisha.id },
      update: {},
      create: {
        id: aisha.id,
        title: 'Color Specialist',
        bio: 'Balayage and vivid color expert. Certified in Olaplex treatments.',
        commissionRate: 38,
        hireDate: new Date('2023-06-15'),
      },
    }),
    prisma.staffProfile.upsert({
      where: { id: lena.id },
      update: {},
      create: {
        id: lena.id,
        title: 'Lead Nail Artist',
        bio: 'Intricate nail art and long-lasting gel applications.',
        commissionRate: 45,
        hireDate: new Date('2024-01-10'),
      },
    }),
  ]);
  console.log('✅ Staff profiles');

  // ── Categories & services ───────────────────────────────────
  const hair = await prisma.category.upsert({
    where: { name: 'Hair' },
    update: {},
    create: { name: 'Hair', displayOrder: 0 },
  });
  const nails = await prisma.category.upsert({
    where: { name: 'Nails' },
    update: {},
    create: { name: 'Nails', displayOrder: 1 },
  });

  const svc = (
    name: string,
    categoryId: string,
    basePrice: number,
    baseDurationMin: number,
    description: string,
  ) =>
    prisma.service.upsert({
      where: { categoryId_name: { categoryId, name } },
      update: {},
      create: { name, categoryId, basePrice, baseDurationMin, description },
    });

  const [haircut, coloring, blowout, manicure, gel, pedicure] = await Promise.all([
    svc('Signature Haircut', hair.id, 25, 45, 'Consultation, wash, precision cut & finish'),
    svc('Full Hair Coloring', hair.id, 60, 90, 'Single-process color with gloss treatment'),
    svc('Blowout Styling', hair.id, 20, 30, 'Wash, blow-dry and heat styling'),
    svc('Classic Manicure', nails.id, 18, 40, 'Shaping, cuticle care & regular polish'),
    svc('Gel Manicure', nails.id, 35, 60, 'Long-lasting gel polish, 2+ week wear'),
    svc('Spa Pedicure', nails.id, 28, 50, 'Soak, scrub, massage & polish'),
  ]);
  console.log('✅ Categories (Hair, Nails) + 6 services');

  // ── Staff ↔ service skills ──────────────────────────────────
  const link = (staffId: string, serviceId: string) =>
    prisma.staffService.upsert({
      where: { staffProfileId_serviceId: { staffProfileId: staffId, serviceId } },
      update: {},
      create: { staffProfileId: staffId, serviceId },
    });

  await Promise.all([
    link(maria.id, haircut.id),
    link(maria.id, blowout.id),
    link(aisha.id, coloring.id),
    link(aisha.id, blowout.id),
    link(lena.id, manicure.id),
    link(lena.id, gel.id),
    link(lena.id, pedicure.id),
  ]);
  console.log('✅ Staff skill assignments');

  // ── Working hours: Mon–Sat 09:00–18:00 ──────────────────────
  const profiles = [maria.id, aisha.id, lena.id];
  await Promise.all(
    profiles.flatMap((staffProfileId) =>
      [1, 2, 3, 4, 5, 6].map((weekday) =>
        prisma.workingHours.upsert({
          where: { staffProfileId_weekday: { staffProfileId, weekday } },
          update: {},
          create: { staffProfileId, weekday, startMinute: 540, endMinute: 1080 },
        }),
      ),
    ),
  );
  console.log('✅ Working hours (Mon–Sat 09:00–18:00)');

  // ── Sample time-off for Lena ────────────────────────────────
  const mondayStart = nextMondayAt(9);
  const existingTimeOff = await prisma.timeOff.findFirst({
    where: { staffProfileId: lena.id, startsAt: mondayStart },
  });
  if (!existingTimeOff) {
    await prisma.timeOff.create({
      data: {
        staffProfileId: lena.id,
        startsAt: mondayStart,
        endsAt: nextMondayAt(13),
        reason: 'Personal errand',
      },
    });
  }
  console.log('✅ Sample time-off entry');

  // ── Portfolio gallery ───────────────────────────────────────
  const portfolioSeed: Array<{ url: string; caption: string }> = [];
  for (let i = 1; i <= 3; i++) portfolioSeed.push({ url: `https://picsum.photos/seed/haircut${i}/600/800`, caption: `Layered cut look ${i}` });
  for (let i = 1; i <= 2; i++) portfolioSeed.push({ url: `https://picsum.photos/seed/balayage${i}/600/800`, caption: `Color work ${i}` });
  for (let i = 1; i <= 3; i++) portfolioSeed.push({ url: `https://picsum.photos/seed/nailart${i}/600/800`, caption: `Nail art design ${i}` });

  let createdPortfolio = 0;
  for (const item of portfolioSeed) {
    const exists = await prisma.portfolioItem.findFirst({ where: { imageUrl: item.url } });
    if (exists) continue;

    const staffProfileId = item.url.includes('nailart')
      ? lena.id
      : item.url.includes('balayage')
        ? aisha.id
        : maria.id;

    await prisma.portfolioItem.create({
      data: { staffProfileId, imageUrl: item.url, caption: item.caption },
    });
    createdPortfolio++;
  }
  console.log(`✅ Portfolio items (${createdPortfolio} created)`);

  // ── Rewards ─────────────────────────────────────────────────
  const rewardSeeds = [
    { name: 'Free Signature Haircut', pointsCost: 200, serviceId: haircut.id, description: 'Redeem for one complimentary signature haircut' },
    { name: 'Free Gel Manicure', pointsCost: 250, serviceId: gel.id, description: 'Redeem for one complimentary gel manicure' },
    { name: '10% Off Any Service', pointsCost: 120, discountPct: 10, description: 'Ten percent off your next booking' },
  ];
  for (const r of rewardSeeds) {
    const exists = await prisma.reward.findFirst({ where: { name: r.name } });
    if (!exists) await prisma.reward.create({ data: r });
  }
  console.log('✅ Loyalty rewards (3 tiers)');

  // ── Demo history: completed visit + review + loyalty points ─
  const demoAppointment = await prisma.appointment.findFirst({
    where: { customerId: sara.id, serviceId: haircut.id },
  });
  if (!demoAppointment) {
    const start = yesterdayAt(14);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    const appointment = await prisma.appointment.create({
      data: {
        customerId: sara.id,
        staffProfileId: maria.id,
        serviceId: haircut.id,
        scheduledFor: start,
        endsAt: end,
        status: 'COMPLETED',
        source: 'APP',
        priceCharged: 25,
      },
    });

    await prisma.review.create({
      data: {
        appointmentId: appointment.id,
        customerId: sara.id,
        staffProfileId: maria.id,
        rating: 5,
        comment: 'Maria understood exactly what I wanted. Best cut I have had in years!',
      },
    });

    await prisma.loyaltyTransaction.create({
      data: {
        customerId: sara.id,
        appointmentId: appointment.id,
        points: 10,
        type: 'EARNED',
        description: 'Points earned for completed appointment',
      },
    });
  }
  console.log('✅ Demo appointment + review + loyalty points');

  console.log('\n🎉 Seed complete! Demo accounts:');
  console.log('   Admin    → admin@salonshop.app / Admin123!');
  console.log('   Stylist  → maria@salonshop.app / Stylist123!');
  console.log('   Customer → sara@example.com / Customer123!');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
