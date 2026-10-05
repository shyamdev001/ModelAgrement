import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { locationRoutes } from './routes/location.routes';
import { stripRoutes } from './routes/strip.routes';
import { describe, locationCount, type Location } from './services/locationService';
import { UserError } from './utils/errors';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // CORS_ORIGIN: only needed when the page is served from a different address than this API.
  const origins = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);
  app.use(cors({ origin: origins.length ? origins : true }));
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, places: locationCount() }));
  app.use('/api/location', locationRoutes);
  app.use('/api/strip', stripRoutes);
  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found.' }));

  // Every failure leaves as { error, message } with a message a field employee can act on.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof UserError) {
      const extra = { ...err.extra };
      if (Array.isArray(extra.candidates)) {
        extra.candidates = (extra.candidates as Location[]).map((location) => ({ ...location, label: describe(location) }));
      }
      return res.status(err.status).json({ error: err.code, message: err.message, ...extra });
    }
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.parse.failed' || type === 'entity.too.large') {
      return res.status(400).json({ error: 'malformed', message: 'The request did not arrive properly. Please try again.' });
    }
    console.error('[server] unexpected error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
