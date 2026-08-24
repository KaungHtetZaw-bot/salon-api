// Minimal OpenAPI spec — endpoints are documented per-module in phases 2+
const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Salon Shop API',
    version: '0.1.0',
    description:
      'REST API for the Salon Shop mobile app — hair & nail salon bookings, staff management, loyalty and reviews.',
  },
  servers: [{ url: '/api' }],
  tags: [
    { name: 'Auth', description: 'Registration, login, tokens' },
    { name: 'Catalog', description: 'Categories & services' },
    { name: 'Staff', description: 'Stylists, schedules, portfolio' },
    { name: 'Bookings', description: 'Appointments & availability' },
    { name: 'Engagement', description: 'Reviews, loyalty, rewards' },
    { name: 'Admin', description: 'Dashboard & reports' },
  ],
  paths: {},
};

export default swaggerSpec;
