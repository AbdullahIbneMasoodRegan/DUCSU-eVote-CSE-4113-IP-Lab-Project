// M1 — mounts each module's router. ONE LINE PER MODULE.
// After Phase 0 this file only changes when a whole new module is added
// (small PR, reviewed by M1).
//
// Every module router is mounted at /api and declares its own full paths, so
// each owner keeps the prefixes listed in the ownership map:
//   M1 auth         /api/auth/*, /api/me
//   M2 election     /api/admin/elections/*, /api/admin/voters/*, /api/admin/nominations/*
//   M2 audit        /api/audit/*
//   M2 results      /api/results/*
//   M3 candidates   /api/candidates/*, /api/panels/*, /api/nominations/*, /api/observer/*
//   M3 turnout      /api/turnout/*
//   M4 voting       /api/ballot/*, /api/vote, /api/receipts/*, /api/admin/photos/*
import { Router } from 'express';
import { query } from './core/db.js';
import authRouter from './modules/auth/router.js';
// import electionRouter from './modules/election/router.js';     // M2
// import auditRouter from './modules/audit/router.js';           // M2
// import resultsRouter from './modules/results/router.js';       // M2
// import candidatesRouter from './modules/candidates/router.js'; // M3
// import turnoutRouter from './modules/turnout/router.js';       // M3
// import votingRouter from './modules/voting/router.js';         // M4

const api = Router();

// Liveness + database check, used by the host's health check and uptime monitor.
api.get('/health', async (req, res) => {
  await query('SELECT 1');
  res.json({ data: { status: 'ok', time: new Date().toISOString() } });
});

api.use(authRouter); // M1
// api.use(electionRouter);   // M2
// api.use(auditRouter);      // M2
// api.use(resultsRouter);    // M2
// api.use(candidatesRouter); // M3
// api.use(turnoutRouter);    // M3
// api.use(votingRouter);     // M4

export default api;
