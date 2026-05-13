import { Router } from 'express';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

export const questsRouter = Router();

// GET /api/quests/daily
questsRouter.get('/daily', requireAuth, async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT dq.*, pqp.progress, pqp.completed
       FROM daily_quests dq
       LEFT JOIN player_quest_progress pqp
         ON pqp.quest_id = dq.id AND pqp.player_id = $1
       WHERE dq.active_date = CURRENT_DATE`,
      [req.player!.playerId],
    );
    res.json({ success: true, data: rows.rows });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});

// GET /api/quests/battlepass
questsRouter.get('/battlepass', requireAuth, async (req, res) => {
  try {
    const [bp, tiers] = await Promise.all([
      db.query(
        `SELECT bs.*, pbp.current_xp, pbp.is_premium
         FROM battle_pass_seasons bs
         LEFT JOIN player_battle_pass pbp
           ON pbp.season = bs.season AND pbp.player_id = $1
         WHERE bs.is_active = true LIMIT 1`,
        [req.player!.playerId],
      ),
      db.query(
        `SELECT bpt.*, pbt.unlocked
         FROM battle_pass_tiers bpt
         LEFT JOIN player_bp_tier_claims pbt
           ON pbt.tier = bpt.tier AND pbt.player_id = $1
         ORDER BY bpt.tier ASC`,
        [req.player!.playerId],
      ),
    ]);
    res.json({ success: true, data: { ...(bp.rows[0] ?? {}), tiers: tiers.rows } });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});

// POST /api/quests/battlepass/claim/:tier
questsRouter.post('/battlepass/claim/:tier', requireAuth, async (req, res) => {
  const tier = parseInt(req.params.tier!, 10);
  try {
    await db.query(
      `INSERT INTO player_bp_tier_claims (player_id, tier, claimed_at)
       VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
      [req.player!.playerId, tier],
    );
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});
