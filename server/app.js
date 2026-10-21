// Builds the Express app (used by index.js and by the tests).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR } from './db.js';
import { HttpError } from './lib.js';
import { sessionMiddleware, requireLogin, authRouter } from './auth.js';
import { catalogRouter } from './catalog.js';
import { stockRouter } from './stockroutes.js';
import { transferRouter } from './transfers.js';
import { salesRouter } from './sales.js';
import { adminRouter } from './admin.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:; frame-ancestors 'none'"
    );
    next();
  });

  // Simple protection against cross-site requests: every change must carry this header.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'af') {
      return next(new HttpError(403, 'BAD_REQUEST', 'Request not allowed.'));
    }
    next();
  });

  app.use('/api', sessionMiddleware);
  app.use('/api', authRouter); // public + login routes live here; each protected route checks itself
  app.use('/api', requireLogin);
  app.use('/api', catalogRouter, stockRouter, transferRouter, salesRouter, adminRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Not found.')));

  app.use('/uploads', express.static(path.join(DATA_DIR, 'uploads'), { maxAge: '7d', index: false }));
  const dist = path.join(ROOT, 'web', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: '1h', index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('The web app is not built yet. Run: npm run build'));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...(err.extra ? { extra: err.extra } : {}) });
    }
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'TOO_BIG', message: 'The upload is too large.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'BAD_JSON', message: 'Bad request.' });
    console.error(err);
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
  });
  return app;
}
