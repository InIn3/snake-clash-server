import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { logger } from '../utils/logger';

export const playersRouter = Router();

// GET /api/players/me
playersRouter.get('/me', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT p.*,
              COALESCE(s.global_rank, 0) as global_rank,
              COALESCE(s.season_rank, 0) as season_rank
       FROM players p
       LEFT JOIN player_stats s ON s.player_id = p.id
       WHERE p.id = $1`,
      [req.player!.playerId],
    );
    const player = rows.rows[0];
    if (!player) { res.status(404).json({ success: false, error: 'Player not found' }); return; }
    res.json({ success: true, data: player });
  } catch (err) {
    logger.error({ err }, 'GET /players/me error');
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/players/:id
playersRouter.get('/:id', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, username, avatar_url, level, xp, total_matches, wins, best_score, created_at FROM players WHERE id = $1',
      [req.params.id],
    );
    const player = rows.rows[0];
    if (!player) { res.status(404).json({ success: false, error: 'Player not found' }); return; }
    res.json({ success: true, data: player });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PATCH /api/players/me
const updateSchema = z.object({
  username:     z.string().min(3).max(24).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  activeSkinId: z.string().max(64).optional(),
  avatarUrl:    z.string().url().optional(),
});

playersRouter.patch('/me', requireAuth, async (req, res) => {
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ success: false, error: 'Invalid data' }); return; }
  const { username, activeSkinId, avatarUrl } = parse.data;

  try {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [req.player!.playerId];

    if (username)     { sets.push(`username = $${params.push(username)}`); }
    if (activeSkinId) { sets.push(`active_skin_id = $${params.push(activeSkinId)}`); }
    if (avatarUrl)    { sets.push(`avatar_url = $${params.push(avatarUrl)}`); }

    const rows = await db.query(
      `UPDATE players SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params,
    );
    res.json({ success: true, data: rows.rows[0] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('unique')) { res.status(409).json({ success: false, error: 'Username already taken' }); return; }
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/players/:id/stats
playersRouter.get('/:id/stats', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT player_id, total_score, avg_score, total_length, total_playtime,
              kill_count, survival_rate, season_rank, global_rank
       FROM player_stats WHERE player_id = $1`,
      [req.params.id],
    );
    res.json({ success: true, data: rows.rows[0] ?? null });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/players/:id/matches
playersRouter.get('/:id/matches', async (req, res) => {
  const page  = parseInt(String(req.query.page  ?? '1'), 10);
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);
  const offset = (page - 1) * limit;

  try {
    const [data, count] = await Promise.all([
      db.query(
        `SELECT * FROM match_results WHERE player_id = $1
         ORDER BY played_at DESC LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset],
      ),
      db.query('SELECT COUNT(*) FROM match_results WHERE player_id = $1', [req.params.id]),
    ]);
    const total = parseInt(String(count.rows[0]?.count ?? '0'), 10);
    res.json({ success: true, data: { items: data.rows, total, page, limit, hasMore: offset + limit < total } });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/players/me/equip-skin
playersRouter.post('/me/equip-skin', requireAuth, async (req, res) => {
  const skinId = req.body.skinId as string;
  if (!skinId) { res.status(400).json({ success: false, error: 'skinId required' }); return; }
  try {
    await db.query('UPDATE players SET active_skin_id = $1, updated_at = NOW() WHERE id = $2', [skinId, req.player!.playerId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});
