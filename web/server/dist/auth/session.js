import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
export const sessionPlugin = fp(async (app, opts) => {
    await app.register(cookie, {
        secret: opts.cookieSecret,
        hook: 'onRequest',
    });
    app.addHook('onRequest', async (req) => {
        const raw = req.cookies.hk_session;
        if (!raw)
            return;
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.authed === true) {
                req.sessionUser = { authed: true, loginAt: parsed.loginAt };
            }
        }
        catch {
            // ignore
        }
    });
});
export function requireAuth(req, reply) {
    if (!req.sessionUser?.authed) {
        reply.code(401).send({ ok: false, error: 'unauthorized' });
        return false;
    }
    return true;
}
//# sourceMappingURL=session.js.map