import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { authMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import { authRouter } from './modules/auth.js';
import { usersRouter } from './modules/users.js';
import { logsRouter } from './modules/logs.js';
import { customersRouter } from './modules/customers.js';
import { followUpsRouter } from './modules/followUps.js';
import { dashboardRouter } from './modules/dashboard.js';
import { excelRouter } from './modules/excel.js';
import { documentsRouter } from './modules/documents.js';

export function createApp({ db, jwtSecret, staticDir, documentStorage, documentLimits }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  const requireAuth = authMiddleware({ db, jwtSecret });
  app.use('/api/auth', authRouter({ db, jwtSecret, requireAuth }));
  app.use('/api/users', usersRouter({ db, requireAuth }));
  app.use('/api/customers/:id/follow-ups', followUpsRouter({ db, requireAuth }));
  app.use('/api/customers', excelRouter({ db, requireAuth }));
  app.use('/api/customers', customersRouter({ db, requireAuth }));
  app.use('/api/operation-logs', logsRouter({ db, requireAuth }));
  app.use('/api/dashboard', dashboardRouter({ db, requireAuth }));
  if (documentStorage) {
    app.use('/api/documents', documentsRouter({
      db,
      requireAuth,
      storage: documentStorage,
      limits: documentLimits
    }));
  }
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
