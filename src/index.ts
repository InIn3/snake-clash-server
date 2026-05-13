import 'dotenv/config';
import http from 'http';
import express from 'express';
import { Server as SocketServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { config } from './config';
import { logger } from './utils/logger';
import { db } from './db/client';
import { authRouter }        from './routes/auth';
import { playersRouter }     from './routes/players';
import { matchRouter }       from './routes/match';
import { leaderboardRouter } from './routes/leaderboard';
import { questsRouter }      from './routes/quests';
import { tournamentsRouter } from './routes/tournaments';
import { inventoryRouter }   from './routes/inventory';
import { apiRateLimit }      from './middleware/rateLimit';
import { registerSocketHandlers } from './websocket/handlers';
import { MatchmakingService } from './websocket/matchmaking';

async function bootstrap() {
  // ── Express app ──────────────────────────────────────────
  const app = express();

  app.use(pinoHttp({ logger, autoLogging: config.env !== 'test' }));
  app.use(helmet({
    contentSecurityPolicy: false, // handled by Next.js
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server
      const allowed = config.cors.origins;
      const ok = allowed.some(o => o === origin) ||
                 /\.vercel\.app$/.test(origin) ||
                 origin === 'http://localhost:3000';
      cb(null, ok);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ── Health check ─────────────────────────────────────────
  app.get('/health', async (_req, res) => {
    let dbOk = false;
    try { await db.query('SELECT 1'); dbOk = true; } catch { /* non-fatal */ }
    // Always return 200 so Railway health check never kills the container
    res.json({ status: dbOk ? 'ok' : 'degraded', db: dbOk ? 'up' : 'unavailable', env: config.env, ts: Date.now() });
  });

  // ── REST API routes ───────────────────────────────────────
  const api = express.Router();
  api.use(apiRateLimit);
  api.use('/auth',         authRouter);
  api.use('/players',      playersRouter);
  api.use('/match',        matchRouter);
  api.use('/leaderboard',  leaderboardRouter);
  api.use('/quests',       questsRouter);
  api.use('/tournaments',  tournamentsRouter);
  api.use('/inventory',    inventoryRouter);

  app.use('/api', api);

  // 404 fallback
  app.use((_req, res) => res.status(404).json({ success: false, error: 'Not found' }));

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ success: false, error: 'Internal server error' });
  });

  // ── HTTP + Socket.io server ───────────────────────────────
  const httpServer = http.createServer(app);

  const io = new SocketServer(httpServer, {
    cors: {
      origin: config.cors.origins,
      credentials: true,
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 10000,
    pingInterval: 5000,
    maxHttpBufferSize: 1e5, // 100 KB per message
    connectionStateRecovery: {
      maxDisconnectionDuration: 5000,
    },
  });

  // ── Matchmaking service (manages all game rooms) ─────────
  const matchmaking = new MatchmakingService(io);
  registerSocketHandlers(io, matchmaking);

  // ── Start ─────────────────────────────────────────────────
  await new Promise<void>((resolve) => {
    httpServer.listen(config.port, () => {
      logger.info(`🐍 Snake Clash backend running on port ${config.port} [${config.env}]`);
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    httpServer.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
