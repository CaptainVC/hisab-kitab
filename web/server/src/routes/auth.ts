import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../auth/authStore.js';

export async function registerAuthRoutes(app: FastifyInstance, opts: { authFile: string; sessionMaxAgeDays: number }) {
  app.post('/api/v1/auth/login', async (req, reply) => {
    const body = (req.body || {}) as any;
    const password = String(body.password || '');
    if (!password) return reply.code(400).send({ ok: false, error: 'missing_password' });

    const ok = await verifyPassword(opts.authFile, password);
    if (!ok) return reply.code(403).send({ ok: false, error: 'bad_password' });

    const session = JSON.stringify({ authed: true, loginAt: new Date().toISOString() });
    const maxAgeSec = Math.max(1, Math.floor((opts.sessionMaxAgeDays || 7) * 24 * 60 * 60));
    reply.setCookie('hk_session', session, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // tailscale-only; can flip to true behind https
      signed: false,
      maxAge: maxAgeSec
    });
    return reply.send({ ok: true });
  });

  app.post('/api/v1/auth/logout', async (_req, reply) => {
    reply.clearCookie('hk_session', { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/api/v1/auth/me', async (req, reply) => {
    return reply.send({ ok: true, authenticated: !!req.sessionUser?.authed, loginAt: req.sessionUser?.loginAt || null });
  });
}
