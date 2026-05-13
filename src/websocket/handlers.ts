import type { Server, Socket } from 'socket.io';
import { verifySocketToken } from '../middleware/auth';
import { MatchmakingService } from './matchmaking';
import { db } from '../db/client';
import { logger } from '../utils/logger';
import type { Direction } from '../types';

// Per-socket message rate limiting (anti-spam / anti-cheat)
const msgCounters = new Map<string, { count: number; resetAt: number }>();
const MAX_MSGS_PER_SECOND = 40;

function checkMsgRate(socketId: string): boolean {
  const now   = Date.now();
  const entry = msgCounters.get(socketId) ?? { count: 0, resetAt: now + 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 1000; }
  entry.count++;
  msgCounters.set(socketId, entry);
  return entry.count <= MAX_MSGS_PER_SECOND;
}

export function registerSocketHandlers(io: Server, matchmaking: MatchmakingService) {

  io.on('connection', (socket: Socket) => {
    logger.debug({ socketId: socket.id }, 'Socket connected');

    // ── Ping/pong for latency measurement ─────────────────
    socket.on('ping', () => socket.emit('pong'));

    // ── Join game / matchmaking ────────────────────────────
    socket.on('client:join', async (data: { token: string; skinId: string }) => {
      if (!checkMsgRate(socket.id)) return;

      const payload = verifySocketToken(data.token);
      if (!payload) {
        socket.emit('server:error', { code: 'UNAUTHORIZED', message: 'Invalid token' });
        socket.disconnect(true);
        return;
      }

      try {
        let player: { id: string; username: string; activeSkinId: string; level: number; xp: number };

        try {
          const rows = await db.query(
            'SELECT id, username, active_skin_id, level, xp FROM players WHERE id = $1',
            [payload.playerId],
          );
          const row = rows.rows[0];
          if (row) {
            player = { id: row.id, username: row.username, activeSkinId: row.active_skin_id, level: row.level, xp: row.xp };
          } else {
            // Guest not persisted to DB — build from JWT payload
            player = { id: payload.playerId, username: payload.username ?? `Player_${payload.playerId.slice(0, 6)}`, activeSkinId: data.skinId ?? 'default-blue', level: 1, xp: 0 };
          }
        } catch {
          // DB unavailable — build from JWT payload
          player = { id: payload.playerId, username: payload.username ?? `Player_${payload.playerId.slice(0, 6)}`, activeSkinId: data.skinId ?? 'default-blue', level: 1, xp: 0 };
        }

        matchmaking.enqueue(socket, player, data.skinId ?? player.activeSkinId);
        socket.data.playerId = player.id;
        socket.data.username = player.username;

      } catch (err) {
        logger.error({ err }, 'Error in client:join');
        socket.emit('server:error', { code: 'SERVER_ERROR', message: 'Internal server error' });
      }
    });

    // ── Ready signal ───────────────────────────────────────
    socket.on('client:ready', () => {
      if (!checkMsgRate(socket.id)) return;
      const room = matchmaking.getRoomForSocket(socket.id);
      room?.handleDirection(socket.id, 'RIGHT', 0); // ack ready
    });

    // ── Direction input ────────────────────────────────────
    socket.on('client:move', (data: { direction: Direction; seq: number }) => {
      if (!checkMsgRate(socket.id)) return;

      // Basic type guard
      const validDirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
      if (!validDirs.includes(data?.direction)) return;

      const room = matchmaking.getRoomForSocket(socket.id);
      room?.handleDirection(socket.id, data.direction, data.seq ?? 0);
    });

    // ── Boost toggle ───────────────────────────────────────
    socket.on('client:boost', (data: { active: boolean }) => {
      if (!checkMsgRate(socket.id)) return;
      const room = matchmaking.getRoomForSocket(socket.id);
      room?.handleBoost(socket.id, !!data?.active);
    });

    // ── Leave queue ────────────────────────────────────────
    socket.on('client:leaveQueue', () => {
      matchmaking.dequeue(socket.id);
      socket.emit('server:leftQueue', {});
    });

    // ── In-game chat ───────────────────────────────────────
    socket.on('client:chat', (data: { message: string }) => {
      if (!checkMsgRate(socket.id)) return;
      const msg = (data?.message ?? '').toString().slice(0, 120).trim();
      if (!msg) return;

      const room = matchmaking.getRoomForSocket(socket.id);
      if (!room) return;

      // Sanitize: strip HTML tags
      const clean = msg.replace(/<[^>]*>/g, '');

      room['io'].to(room.getRoomId()).emit('server:chat', {
        playerId:   socket.data.playerId,
        playerName: socket.data.username ?? 'Anonymous',
        message:    clean,
      });
    });

    // ── Disconnect ─────────────────────────────────────────
    socket.on('disconnect', (reason: string) => {
      logger.debug({ socketId: socket.id, reason }, 'Socket disconnected');
      matchmaking.handleDisconnect(socket.id);
      msgCounters.delete(socket.id);
    });

    // ── Stats endpoint (admin/debug) ───────────────────────
    socket.on('admin:stats', (cb: (d: object) => void) => {
      if (typeof cb !== 'function') return;
      cb({
        rooms:  matchmaking.getRoomCount(),
        queued: matchmaking.getQueueCount(),
      });
    });
  });

  logger.info('Socket.io handlers registered');
}
