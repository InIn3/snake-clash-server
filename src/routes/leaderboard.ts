import { Router } from 'express';
import { db } from '../db/client';

export const leaderboardRouter = Router();

// GET /api/leaderboard/global
leaderboardRouter.get('/global', async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'), 10));
  const limit = Math.min(100, parseInt(String(req.query.limit ?? '100'), 10));
  const offset = (page - 1) * limit;
  try {
    const [data, count] = await Promise.all([
      db.query(
        `SELECT p.id as player_id, p.username as player_name, p.avatar_url,
                p.best_score as score, p.total_matches, p.wins,
                COALESCE(ps.global_rank, 0) as rank
         FROM players p
         LEFT JOIN player_stats ps ON ps.player_id = p.id
         WHERE p.is_guest = false
         ORDER BY p.best_score DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      db.query(`SELECT COUNT(*) FROM players WHERE is_guest = false`),
    ]);
    const total = parseInt(String(count.rows[0]?.count ?? '0'), 10);
    res.json({ success: true, data: { items: data.rows, total, page, limit, hasMore: offset + limit < total } });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});

// GET /api/leaderboard/daily
leaderboardRouter.get('/daily', async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT p.id as player_id, p.username as player_name, p.avatar_url,
              MAX(mr.score) as score, COUNT(*) as matches_today,
              ROW_NUMBER() OVER (ORDER BY MAX(mr.score) DESC) as rank
       FROM match_results mr
       JOIN players p ON p.id = mr.player_id
       WHERE mr.played_at >= NOW() - INTERVAL '24 hours'
       GROUP BY p.id, p.username, p.avatar_url
       ORDER BY score DESC LIMIT 100`,
    );
    res.json({ success: true, data: rows.rows });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});

// GET /api/leaderboard/season/:season
leaderboardRouter.get('/season/:season', async (req, res) => {
  const season = parseInt(req.params.season!, 10);
  const page   = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  try {
    const rows = await db.query(
      `SELECT p.id as player_id, p.username as player_name, p.avatar_url,
              sl.total_score as score, sl.rank
       FROM season_leaderboard sl
       JOIN players p ON p.id = sl.player_id
       WHERE sl.season = $1
       ORDER BY sl.rank ASC LIMIT 100 OFFSET $2`,
      [season, (page - 1) * 100],
    );
    res.json({ success: true, data: { items: rows.rows, page } });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});

// GET /api/leaderboard/rank/:playerId
leaderboardRouter.get('/rank/:playerId', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT global_rank, season_rank FROM player_stats WHERE player_id = $1`,
      [req.params.playerId],
    );
    res.json({ success: true, data: rows.rows[0] ?? { globalRank: 0, seasonRank: 0 } });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});
