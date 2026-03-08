import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance, opts: { appVersion: string; startedAt: string }) {
  app.get('/api/v1/health', async (_req, reply) => {
    return reply.send({ ok: true, appVersion: opts.appVersion, startedAt: opts.startedAt, time: new Date().toISOString() });
  });
}
