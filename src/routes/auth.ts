import { Router } from 'express';
import { ethers } from 'ethers';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { db } from '../db/client';
import { signToken } from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimit';
import { logger } from '../utils/logger';

export const authRouter = Router();

// ── Wallet auth ────────────────────────────────────────────────
const walletSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  signature:     z.string().min(1),
  message:       z.string().min(1),
  username:      z.string().min(3).max(24).optional(),
});

authRouter.post('/wallet', authRateLimit, async (req, res) => {
  const parse = walletSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ success: false, error: 'Invalid request', details: parse.error.flatten() });
    return;
  }
  const { walletAddress, signature, message, username } = parse.data;

  try {
    const recovered = ethers.verifyMessage(message, signature).toLowerCase();
    if (recovered !== walletAddress.toLowerCase()) {
      res.status(401).json({ success: false, error: 'Signature verification failed' });
      return;
    }

    const addr = walletAddress.toLowerCase();
    let playerId = uuid();
    let playerUsername = username ?? `Player_${addr.slice(2, 8)}`;

    // Try DB — non-fatal if unavailable
    try {
      const existing = (await db.query(
        'SELECT id, username FROM players WHERE wallet_address = $1', [addr],
      )).rows[0];

      if (existing) {
        playerId        = existing.id;
        playerUsername  = existing.username;
      } else {
        await db.query(
          `INSERT INTO players (id, username, wallet_address, created_at, updated_at)
           VALUES ($1, $2, $3, NOW(), NOW())`,
          [playerId, playerUsername, addr],
        );
        logger.info({ playerId }, 'New player registered via wallet');
      }
    } catch (dbErr) {
      logger.warn({ dbErr }, 'DB unavailable — issuing wallet token without persistence');
    }

    const token = signToken({ playerId, walletAddress: addr, username: playerUsername });
    res.json({ success: true, data: { token, playerId, username: playerUsername } });

  } catch (err) {
    logger.error({ err }, 'Wallet auth error');
    res.status(500).json({ success: false, error: 'Auth failed' });
  }
});

// ── Guest auth ─────────────────────────────────────────────────
const guestSchema = z.object({
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_-]+$/),
});

authRouter.post('/guest', authRateLimit, async (req, res) => {
  const parse = guestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ success: false, error: 'Invalid username — use 3-24 alphanumeric characters' });
    return;
  }
  const { username } = parse.data;
  const playerId = uuid();

  // Try DB — non-fatal if unavailable
  try {
    await db.query(
      `INSERT INTO players (id, username, is_guest, created_at, updated_at)
       VALUES ($1, $2, true, NOW(), NOW())`,
      [playerId, username],
    );
  } catch (dbErr) {
    logger.warn({ dbErr }, 'DB unavailable — issuing guest token without persistence');
  }

  // Always succeed — JWT is valid even without DB record
  const token = signToken({ playerId, username });
  res.json({ success: true, data: { token, playerId } });
});

// ── Refresh token ──────────────────────────────────────────────
authRouter.post('/refresh', async (req, res) => {
  const player = (req as typeof req & { player?: { playerId: string; username: string; walletAddress?: string } }).player;
  if (!player) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }
  const token = signToken({ playerId: player.playerId, username: player.username, walletAddress: player.walletAddress });
  res.json({ success: true, data: { token } });
});
