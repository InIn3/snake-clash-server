import { Router } from 'express';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

export const tournamentsRouter = Router();

tournamentsRouter.get('/active', async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT * FROM tournaments WHERE status IN ('UPCOMING','ACTIVE') ORDER BY start_time ASC`
    );
    res.json({ success: true, data: rows.rows });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});

tournamentsRouter.post('/:id/register', requireAuth, async (req, res) => {
  try {
    await db.query(
      `INSERT INTO tournament_registrations (tournament_id, player_id, registered_at)
       VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
      [req.params.id, req.player!.playerId],
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});

tournamentsRouter.get('/:id/results', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT tr.rank, p.id as player_id, p.username as player_name, tr.score
       FROM tournament_results tr
       JOIN players p ON p.id = tr.player_id
       WHERE tr.tournament_id = $1 ORDER BY tr.rank ASC`,
      [req.params.id],
    );
    res.json({ success: true, data: rows.rows });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});
