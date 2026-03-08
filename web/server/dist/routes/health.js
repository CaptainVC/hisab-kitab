export async function registerHealthRoutes(app, opts) {
    app.get('/api/v1/health', async (_req, reply) => {
        return reply.send({ ok: true, appVersion: opts.appVersion, startedAt: opts.startedAt, time: new Date().toISOString() });
    });
}
//# sourceMappingURL=health.js.map