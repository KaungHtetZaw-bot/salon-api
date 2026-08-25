import type { NextFunction, Request, Response } from 'express';

type Spec = Record<string, unknown>;

// ── helpers to keep the spec readable ─────────────────────────────
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schemaName: string) => ({
  required: true,
  content: { 'application/json': { schema: ref(schemaName) } },
});
const ok = (schemaName?: string) => ({
  description: 'Success',
  ...(schemaName
    ? {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { success: { type: 'boolean' }, data: ref(schemaName) },
            },
          },
        },
      }
    : {}),
});
const created = (schemaName?: string) => ok(schemaName);
const errResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});
const op = (
  summary: string,
  tag: string,
  extra: Spec = {},
): Spec => ({ summary, tags: [tag], responses: {}, ...extra });
const secured = [{ bearerAuth: [] }];
const pathId = (name: string, description: string) => ({
  name,
  in: 'path' as const,
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description,
});

const rangeParams = [
  { name: 'from', in: 'query', schema: { type: 'string', example: '2026-09-01' } },
  { name: 'to', in: 'query', schema: { type: 'string', example: '2026-09-30' } },
];

const paths: Spec = {
  // ── health ──
  '/health': { get: op('Liveness probe', 'Health') },
  '/health/ready': { get: op('Readiness probe (checks DB)', 'Health') },

  // ── auth ──
  '/api/auth/register': {
    post: op('Create customer account (auto-login)', 'Auth', {
      requestBody: jsonBody('RegisterInput'),
      responses: {
        ...created('AuthSession'),
        ...errResponse('409 email already exists · 422 validation failed'),
      },
    }),
  },
  '/api/auth/login': {
    post: op('Login with email + password', 'Auth', {
      requestBody: jsonBody('LoginInput'),
      responses: { ...ok('AuthSession'), ...errResponse('401 invalid credentials') },
    }),
  },
  '/api/auth/refresh': {
    post: op('Rotate refresh token, get new pair', 'Auth', {
      requestBody: jsonBody('RefreshInput'),
      responses: { ...ok('AuthSession'), ...errResponse('401 unknown/expired/replayed token') },
    }),
  },
  '/api/auth/logout': {
    post: op('Revoke the given refresh token', 'Auth', {
      security: secured,
      requestBody: jsonBody('RefreshInput'),
      responses: ok(),
    }),
  },
  '/api/auth/me': {
    get: op('Current user profile', 'Auth', {
      security: secured,
      responses: { ...ok('User'), ...errResponse('401/403') },
    }),
  },

  // ── catalog ──
  '/api/catalog/categories': {
    get: op('Active categories with nested services', 'Catalog'),
  },
  '/api/catalog/services': {
    get: op('Active services (filter by category)', 'Catalog', {
      parameters: [
        { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      ],
    }),
  },

  // ── staff (public) ──
  '/api/staff': { get: op('Bookable stylists with rating summaries', 'Staff') },
  '/api/staff/{id}': {
    get: op('Stylist detail: skills, prices, portfolio', 'Staff', {
      parameters: [pathId('id', 'Staff/user id')],
    }),
  },
  '/api/staff/{id}/portfolio': {
    get: op('Portfolio gallery', 'Staff', { parameters: [pathId('id', 'Staff id')] }),
  },

  // ── bookings ──
  '/api/bookings/availability': {
    get: op('Open slots for a service on a date', 'Bookings', {
      parameters: [
        { name: 'serviceId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'date', in: 'query', required: true, schema: { type: 'string', example: '2026-09-01' } },
        { name: 'staffId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      ],
      responses: ok('Availability'),
    }),
  },
  '/api/bookings/appointments': {
    post: op('Book an appointment (auto-assigns stylist)', 'Bookings', {
      security: secured,
      requestBody: jsonBody('CreateAppointment'),
      responses: { ...created('Appointment'), ...errResponse('409 slot taken') },
    }),
    get: op('List appointments (role-aware scope)', 'Bookings', {
      security: secured,
      parameters: [
        { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/AppointmentStatus' } },
        { name: 'date', in: 'query', schema: { type: 'string', example: '2026-09-01' } },
      ],
      responses: ok(),
    }),
  },
  '/api/bookings/appointments/{id}': {
    get: op('Appointment detail (owner/staff/admin)', 'Bookings', {
      security: secured,
      parameters: [pathId('id', 'Appointment id')],
      responses: { ...ok('Appointment'), ...errResponse('403 not yours') },
    }),
  },
  '/api/bookings/appointments/{id}/cancel': {
    patch: op('Cancel — customers bound by free-cancellation window', 'Bookings', {
      security: secured,
      parameters: [pathId('id', 'Appointment id')],
      requestBody: { content: { 'application/json': { schema: ref('CancelInput') } } },
      responses: { ...ok('Appointment'), ...errResponse('409 window passed / already cancelled') },
    }),
  },
  '/api/bookings/appointments/{id}/reschedule': {
    patch: op('Reschedule own booking to a new time', 'Bookings', {
      security: secured,
      parameters: [pathId('id', 'Appointment id')],
      requestBody: jsonBody('RescheduleInput'),
      responses: ok('Appointment'),
    }),
  },
  '/api/bookings/appointments/{id}/status': {
    patch: op('Transition status (staff) — COMPLETED awards loyalty', 'Bookings', {
      security: secured,
      parameters: [pathId('id', 'Appointment id')],
      requestBody: jsonBody('StatusUpdate'),
      responses: ok('Appointment'),
    }),
  },
  '/api/bookings/walk-in': {
    post: op('Add walk-in (existing customer or instant guest)', 'Bookings', {
      security: secured,
      requestBody: jsonBody('WalkIn'),
      responses: { ...created('Appointment'), ...errResponse('409 busy slot') },
    }),
  },
  '/api/bookings/schedule': {
    get: op("Day sheet for a stylist", 'Bookings', {
      security: secured,
      parameters: [
        { name: 'date', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'staffId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      ],
      responses: ok(),
    }),
  },

  // ── reviews ──
  '/api/reviews/staff/{staffId}': {
    get: op('Public paginated reviews for a stylist', 'Engagement', {
      parameters: [
        pathId('staffId', 'Staff id'),
        { name: 'page', in: 'query', schema: { type: 'integer' } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
      ],
      responses: ok(),
    }),
  },
  '/api/reviews': {
    post: op('Review a completed own visit', 'Engagement', {
      security: secured,
      requestBody: jsonBody('CreateReview'),
      responses: { ...created('Review'), ...errResponse('409 already reviewed') },
    }),
  },
  '/api/reviews/{id}': {
    patch: op('Edit own review', 'Engagement', {
      security: secured,
      parameters: [pathId('id', 'Review id')],
      requestBody: jsonBody('UpdateReview'),
      responses: ok('Review'),
    }),
    delete: op('Delete own review', 'Engagement', {
      security:secured,
      parameters: [pathId('id', 'Review id')],
      responses: ok(),
    }),
  },
  '/api/reviews/{id}/reply': {
    post: op('Salon reply (that stylist or admin)', 'Engagement', {
      security: secured,
      parameters: [pathId('id', 'Review id')],
      requestBody: jsonBody('ReplyInput'),
      responses: ok('Review'),
    }),
  },

  // ── loyalty ──
  '/api/loyalty/balance': {
    get: op('Points balance + next-reward hint', 'Engagement', { security: secured, responses: ok('Balance') }),
  },
  '/api/loyalty/history': {
    get: op('Points ledger (paginated)', 'Engagement', { security: secured, responses: ok() }),
  },
  '/api/loyalty/rewards': {
    get: op('Active rewards catalog', 'Engagement', { security: secured, responses: ok() }),
  },
  '/api/loyalty/rewards/{id}/redeem': {
    post: op('Redeem a reward (race-safe)', 'Engagement', {
      security: secured,
      parameters: [pathId('id', 'Reward id')],
      responses: { ...created('RedemptionResult'), ...errResponse('409 insufficient points') },
    }),
  },
  '/api/loyalty/redemptions': {
    get: op('My vouchers', 'Engagement', { security: secured, responses: ok() }),
  },
  '/api/loyalty/redemptions/{id}/use': {
    patch: op('Mark voucher used (staff scan)', 'Engagement', {
      security: secured,
      parameters: [pathId('id', 'Voucher id')],
      responses: ok(),
    }),
  },

  // ── notifications ──
  '/api/notifications/devices': {
    post: op('Register FCM device token (upsert)', 'Notifications', {
      security: secured,
      requestBody: jsonBody('DeviceRegistration'),
      responses: created(),
    }),
    get: op('My registered devices', 'Notifications', { security: secured }),
    delete: op('Remove a device', 'Notifications', {
      security: secured,
      requestBody: jsonBody('DeviceRemoval'),
      responses: ok(),
    }),
  },
  '/api/notifications': {
    get: op('Notification center with unreadCount', 'Notifications', {
      security: secured,
      responses: ok(),
    }),
  },
  '/api/notifications/{id}/read': {
    patch: op('Mark one as read', 'Notifications', {
      security: secured,
      parameters: [pathId('id', 'Notification id')],
      responses: ok(),
    }),
  },
  '/api/notifications/read-all': {
    patch: op('Mark all as read', 'Notifications', { security: secured }),
  },

  // ── admin: catalog ──
  '/api/admin/catalog/categories': {
    post: op('Create category', 'Admin', {
      security: secured,
      requestBody: jsonBody('CreateCategory'),
      responses: { ...created(), ...errResponse('409 duplicate active name') },
    }),
  },
  '/api/admin/catalog/categories/{id}': {
    patch: op('Update category', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Category id')],
      requestBody: jsonBody('UpdateCategory'),
      responses: ok(),
    }),
    delete: op('Soft-delete category (hides its services too)', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Category id')],
      responses: ok(),
    }),
  },
  '/api/admin/catalog/services': {
    get: op('All services incl. inactive', 'Admin', { security: secured }),
    post: op('Create service', 'Admin', {
      security: secured,
      requestBody: jsonBody('CreateService'),
      responses: created('Service'),
    }),
  },
  '/api/admin/catalog/services/{id}': {
    patch: op('Update service', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Service id')],
      requestBody: jsonBody('UpdateService'),
      responses: ok('Service'),
    }),
    delete: op('Soft-delete service', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Service id')],
      responses: ok(),
    }),
  },

  // ── admin: staff ──
  '/api/admin/staff': {
    get: op('All staff incl. inactive + working hours', 'Admin', { security: secured }),
    post: op('Create stylist (user+profile+hours atomically)', 'Admin', {
      security: secured,
      requestBody: jsonBody('CreateStaff'),
      responses: created(),
    }),
  },
  '/api/admin/staff/{id}': {
    patch: op('Update stylist profile/settings', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Staff id')],
      requestBody: jsonBody('UpdateStaff'),
      responses: ok(),
    }),
  },
  '/api/admin/staff/{id}/working-hours': {
    put: op('Replace weekly schedule', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Staff id')],
      requestBody: jsonBody('WorkingHoursReplacement'),
      responses: ok(),
    }),
  },
  '/api/admin/staff/{id}/portfolio': {
    post: op('Add portfolio photo', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Staff id')],
      requestBody: jsonBody('PortfolioItemInput'),
      responses: created(),
    }),
  },
  '/api/admin/staff/portfolio/{itemId}': {
    delete: op('Remove portfolio photo', 'Admin', {
      security: secured,
      parameters: [pathId('itemId', 'Portfolio item id')],
      responses: ok(),
    }),
  },

  // ── admin: engagement ──
  '/api/admin/rewards': {
    get: op('All rewards incl. inactive', 'Admin', { security: secured }),
    post: op('Create reward', 'Admin', {
      security: secured,
      requestBody: jsonBody('CreateReward'),
      responses: created(),
    }),
  },
  '/api/admin/rewards/{id}': {
    patch: op('Update reward', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Reward id')],
      requestBody: jsonBody('UpdateReward'),
      responses: ok(),
    }),
    delete: op('Deactivate reward', 'Admin', {
      security: secured,
      parameters: [pathId('id', 'Reward id')],
      responses: ok(),
    }),
  },
  '/api/admin/loyalty/adjust': {
    post: op('Manually adjust customer points (audited)', 'Admin', {
      security: secured,
      requestBody: jsonBody('AdjustPoints'),
      responses: created(),
    }),
  },

  // ── admin: reports ──
  '/api/admin/reports/overview': {
    get: op('Revenue, bookings, new customers, avg ticket', 'Reports', {
      security: secured,
      parameters: rangeParams,
      responses: ok('OverviewReport'),
    }),
  },
  '/api/admin/reports/revenue': {
    get: op('Chart-ready revenue series', 'Reports', {
      security: secured,
      parameters: [
        ...rangeParams,
        { name: 'groupBy', in: 'query', schema: { type: 'string', enum: ['day', 'month'] } },
      ],
      responses: ok('RevenueSeries'),
    }),
  },
  '/api/admin/reports/top-services': {
    get: op('Most-completed services by revenue', 'Reports', {
      security: secured,
      parameters: [
        ...rangeParams,
        { name: 'limit', in: 'query', schema: { type: 'integer' } },
      ],
      responses: ok(),
    }),
  },
  '/api/admin/reports/staff-performance': {
    get: op('Per-stylist revenue, commission, utilization', 'Reports', {
      security: secured,
      parameters: rangeParams,
      responses: ok('StaffPerformanceReport'),
    }),
  },
};

const schemas: Spec = {
  Error: {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      message: { type: 'string' },
      details: {},
    },
  },
  RegisterInput: {
    type: 'object',
    required: ['fullName', 'email', 'password'],
    properties: {
      fullName: { type: 'string', minLength: 2 },
      email: { type: 'string', format: 'email' },
      phone: { type: 'string' },
      password: { type: 'string', minLength: 8, maxLength: 72 },
    },
  },
  LoginInput: {
    type: 'object',
    required: ['email', 'password'],
    properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } },
  },
  RefreshInput: {
    type: 'object',
    required: ['refreshToken'],
    properties: { refreshToken: { type: 'string' } },
  },
  User: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      fullName: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string', nullable: true },
      role: { type: 'string', enum: ['CUSTOMER', 'STAFF', 'ADMIN'] },
      avatarUrl: { type: 'string', nullable: true },
      locale: { type: 'string' },
    },
  },
  AuthSession: {
    type: 'object',
    properties: {
      user: ref('User'),
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
    },
  },
  Service: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      categoryId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string', nullable: true },
      basePrice: { type: 'number' },
      baseDurationMin: { type: 'integer' },
      imageUrl: { type: 'string', nullable: true },
      isActive: { type: 'boolean' },
    },
  },
  CreateCategory: {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' }, displayOrder: { type: 'integer' } },
  },
  UpdateCategory: {
    type: 'object',
    properties: { name: { type: 'string' }, displayOrder: { type: 'integer' }, isActive: { type: 'boolean' } },
  },
  CreateService: {
    type: 'object',
    required: ['categoryId', 'name', 'basePrice', 'baseDurationMin'],
    properties: {
      categoryId: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      description: { type: 'string' },
      basePrice: { type: 'number' },
      baseDurationMin: { type: 'integer' },
      imageUrl: { type: 'string' },
    },
  },
  UpdateService: { type: 'object', description: 'Partial CreateService fields + isActive' },
  Availability: {
    type: 'object',
    properties: {
      date: { type: 'string' },
      durationMin: { type: 'integer' },
      bufferMin: { type: 'integer' },
      slots: { type: 'array', items: { type: 'string', example: '11:00' } },
      perStaff: { type: 'array', items: { type: 'object' } },
    },
  },
  AppointmentStatus: {
    type: 'string',
    enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  },
  Appointment: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      status: ref('AppointmentStatus'),
      source: { type: 'string', enum: ['APP', 'WALK_IN'] },
      scheduledFor: { type: 'string', format: 'date-time' },
      endsAt: { type: 'string', format: 'date-time' },
      priceCharged: { type: 'number' },
      notes: { type: 'string', nullable: true },
      customer: { type: 'object' },
      staff: { type: 'object' },
      service: { type: 'object' },
      cancelledBy: { type: 'string', nullable: true },
      cancelReason: { type: 'string', nullable: true },
      cancelledAt: { type: 'string', nullable: true },
    },
  },
  CreateAppointment: {
    type: 'object',
    required: ['serviceId', 'scheduledFor'],
    properties: {
      serviceId: { type: 'string', format: 'uuid' },
      staffId: { type: 'string', format: 'uuid' },
      scheduledFor: { type: 'string', example: '2026-09-01T11:00', description: 'salon-local naive datetime' },
      notes: { type: 'string' },
    },
  },
  CancelInput: { type: 'object', properties: { reason: { type: 'string' } } },
  RescheduleInput: {
    type: 'object',
    required: ['scheduledFor'],
    properties: { scheduledFor: { type: 'string', example: '2026-09-01T17:00' } },
  },
  StatusUpdate: {
    type: 'object',
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] },
      reason: { type: 'string' },
    },
  },
  WalkIn: {
    type: 'object',
    required: ['serviceId'],
    properties: {
      customerId: { type: 'string', format: 'uuid' },
      customerName: { type: 'string', description: 'creates guest when customerId omitted' },
      phone: { type: 'string' },
      serviceId: { type: 'string', format: 'uuid' },
      staffId: { type: 'string', format: 'uuid' },
      scheduledFor: { type: 'string', example: '2026-09-01T14:00' },
      notes: { type: 'string' },
    },
  },
  CreateStaff: {
    type: 'object',
    required: ['fullName', 'email', 'password'],
    properties: {
      fullName: { type: 'string' },
      email: { type: 'string' },
      password: { type: 'string' },
      phone: { type: 'string' },
      title: { type: 'string' },
      bio: { type: 'string' },
      commissionRate: { type: 'number', example: 40 },
      workingHours: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            weekday: { type: 'integer', minimum: 0, maximum: 6 },
            startMinute: { type: 'integer', example: 540 },
            endMinute: { type: 'integer', example: 1080 },
          },
        },
      },
    },
  },
  UpdateStaff: {
    type: 'object',
    properties: {
      fullName: { type: 'string' },
      phone: { type: 'string', nullable: true },
      title: { type: 'string', nullable: true },
      bio: { type: 'string', nullable: true },
      commissionRate: { type: 'number' },
      isBookable: { type: 'boolean' },
      isActive: { type: 'boolean' },
    },
  },
  WorkingHoursReplacement: {
    type: 'object',
    required: ['hours'],
    properties: { hours: { type: 'array', items: { type: 'object' } } },
  },
  PortfolioItemInput: {
    type: 'object',
    required: ['imageUrl'],
    properties: {
      imageUrl: { type: 'string', format: 'uri' },
      caption: { type: 'string' },
      serviceId: { type: 'string', format: 'uuid' },
    },
  },
  Review: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      comment: { type: 'string', nullable: true },
      staffReply: { type: 'string', nullable: true },
      createdAt: { type: 'string', format: 'date-time' },
      customerFirstName: { type: 'string' },
      serviceName: { type: 'string', nullable: true },
    },
  },
  CreateReview: {
    type: 'object',
    required: ['appointmentId', 'rating'],
    properties: {
      appointmentId: { type: 'string', format: 'uuid' },
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      comment: { type: 'string' },
    },
  },
  UpdateReview: {
    type: 'object',
    properties: { rating: { type: 'integer' }, comment: { type: 'string', nullable: true } },
  },
  ReplyInput: { type: 'object', required: ['reply'], properties: { reply: { type: 'string' } } },
  Balance: {
    type: 'object',
    properties: {
      balance: { type: 'integer' },
      nextReward: { type: 'object', nullable: true },
    },
  },
  Reward: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      pointsCost: { type: 'integer' },
      discountPct: { type: 'integer', nullable: true },
      freeService: { type: 'object', nullable: true },
    },
  },
  CreateReward: {
    type: 'object',
    required: ['name', 'pointsCost'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      pointsCost: { type: 'integer' },
      serviceId: { type: 'string', format: 'uuid' },
      discountPct: { type: 'integer' },
    },
  },
  UpdateReward: { type: 'object', description: 'Partial reward fields + isActive' },
  RedemptionResult: {
    type: 'object',
    properties: {
      voucherId: { type: 'string' },
      status: { type: 'string' },
      pointsSpent: { type: 'integer' },
      remainingBalance: { type: 'integer' },
    },
  },
  AdjustPoints: {
    type: 'object',
    required: ['customerId', 'points'],
    properties: {
      customerId: { type: 'string', format: 'uuid' },
      points: { type: 'integer', description: 'positive or negative, never zero' },
      description: { type: 'string' },
    },
  },
  DeviceRegistration: {
    type: 'object',
    required: ['fcmToken', 'platform'],
    properties: {
      fcmToken: { type: 'string' },
      platform: { type: 'string', enum: ['IOS', 'ANDROID'] },
    },
  },
  DeviceRemoval: { type: 'object', required: ['fcmToken'], properties: { fcmToken: { type: 'string' } } },
  OverviewReport: {
    type: 'object',
    properties: {
      revenue: { type: 'number' },
      completedBookings: { type: 'integer' },
      totalBookings: { type: 'integer' },
      bookingsByStatus: { type: 'object' },
      newCustomers: { type: 'integer' },
      averageTicket: { type: 'number' },
    },
  },
  RevenueSeries: {
    type: 'object',
    properties: {
      groupBy: { type: 'string' },
      totalRevenue: { type: 'number' },
      totalBookings: { type: 'integer' },
      series: { type: 'array', items: { type: 'object' } },
    },
  },
  StaffPerformanceReport: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            fullName: { type: 'string' },
            completedBookings: { type: 'integer' },
            cancelledBookings: { type: 'integer' },
            revenue: { type: 'number' },
            estimatedCommission: { type: 'number' },
            utilizationPct: { type: 'integer', nullable: true },
          },
        },
      },
    },
  },
};

const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Salon Shop API',
    version: '1.0.0',
    description:
      'REST API for the Salon Shop mobile app — hair & nail salon bookings, staff management, loyalty, reviews and reports.\n\n' +
      '**Time convention:** booking datetimes are salon-local naive strings (`YYYY-MM-DDTHH:mm`).\n\n' +
      '**Auth:** `Authorization: Bearer <accessToken>`; access tokens last ~15 min, refresh via `/api/auth/refresh`.',
  },
  servers: [{ url: '/', description: 'same origin (mounted under /api)' }],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Catalog' },
    { name: 'Staff' },
    { name: 'Bookings' },
    { name: 'Engagement' },
    { name: 'Notifications' },
    { name: 'Admin' },
    { name: 'Reports' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas,
  },
  paths,
};

export default swaggerSpec;
