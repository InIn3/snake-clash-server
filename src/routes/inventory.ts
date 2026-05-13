import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

export const inventoryRouter = Router();

// POST /api/inventory/sync  — sync NFTs from chain into player inventory
inventoryRouter.post('/sync', requireAuth, async (req, res) => {
  const schema = z.object({
    walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    tokenIds:      z.array(z.number().int().nonnegative()).max(200),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ success: false, error: 'Invalid request' }); return; }

  const { walletAddress, tokenIds } = parse.data;
  const playerId = req.player!.playerId;

  try {
    for (const tokenId of tokenIds) {
      await db.query(
        `INSERT INTO player_nft_skins (player_id, token_id, wallet_address, synced_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (player_id, token_id) DO UPDATE SET wallet_address = $3, synced_at = NOW()`,
        [playerId, tokenId, walletAddress.toLowerCase()],
      );
    }
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, error: 'Sync failed' }); }
});

// GET /api/inventory/market
inventoryRouter.get('/market', async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
  const limit = 20;
  const offset = (page - 1) * limit;
  try {
    const rows = await db.query(
      `SELECT ml.*, p.username as seller_username
       FROM market_listings ml
       JOIN players p ON p.id = ml.seller_id
       WHERE ml.active = true ORDER BY ml.listed_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const total = (await db.query('SELECT COUNT(*) FROM market_listings WHERE active = true')).rows[0]?.count ?? 0;
    res.json({ success: true, data: { items: rows.rows, total: parseInt(String(total), 10), page, limit } });
  } catch { res.status(500).json({ success: false, error: 'Server error' }); }
});
