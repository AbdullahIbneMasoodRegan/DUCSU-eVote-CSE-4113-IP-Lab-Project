// M1 — builds the Express app. One service serves both the API (/api/*) and
// the built React app, so cookies are same-origin (no CORS, no third-party
// cookie problems on Safari).
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import config from './core/config.js';
import { requestLogger } from './core/middleware/requestLogger.js';
import { errorHandler, apiNotFound } from './core/middleware/errorHandler.js';
import apiRouter from './routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Render/Railway put one proxy in front of the app; needed for secure cookies and req.ip.
  if (config.isProd) app.set('trust proxy', 1);

  app.use(securityHeaders());
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', apiRouter);
  app.use('/api', apiNotFound);

  // Serve the built client (client/dist) with an SPA fallback for page routes.
  const dist = path.join(config.repoRoot, 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: config.isProd ? '1h' : 0 }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

/**
 * Security headers (NFR-05). The Content-Security-Policy allows only this
 * site's own scripts, Google Fonts, and camera/photo previews (blob: and data:
 * images). HSTS and the HTTPS upgrade are production-only, so the app still
 * runs over plain http://localhost during development.
 */
function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 15_552_000 } : false,
  });
}

export default createApp;
