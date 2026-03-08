import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance, opts: { appVersion: string }) {
  app.get('/api/v1/health', async (_req, reply) => {
    return reply.send({ ok: true, appVersion: opts.appVersion, time: new Date().toISOString() });
  });
}
