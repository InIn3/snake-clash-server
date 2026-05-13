import { Router } from 'express';
import { ethers } from 'ethers';
import { z } from 'zod';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { matchRateLimit } from '../middleware/rateLimit';
import { config } from '../config';
import { logger } from '../utils/logger';

export const matchRouter = Router();

// POST /api/match/queue  — returns room token so client can connect via WS
const queueSchema = z.object({
  skinId: z.string().max(64).optional(),
  mode:   z.enum(['CASUAL', 'RANKED', 'TOURNAMENT']).default('CASUAL'),
});

matchRouter.post('/queue', requireAuth, matchRateLimit, async (req, res) => {
  const parse = queueSchema.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ success: false, error: 'Invalid request' }); return; }

  // The actual matchmaking happens over WebSocket once client connects.
  // We return the auth token (same JWT) so client can authenticate the WS connection.
  res.json({
    success: true,
    data: {
      token:    req.headers.authorization?.slice(7) ?? '',
      mode:     parse.data.mode,
      skinId:   parse.data.skinId ?? 'default-blue',
      position: 1,
    },
  });
});

// DELETE /api/match/queue
matchRouter.delete('/queue', requireAuth, async (_req, res) => {
  // Actual queue removal is handled via socket 'client:leaveQueue'
  res.json({ success: true });
});

// GET /api/match/:id
matchRouter.get('/:id', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM match_results WHERE match_id = $1', [req.params.id]);
    if (!rows.rows[0]) { res.status(404).json({ success: false, error: 'Match not found' }); return; }
    res.json({ success: true, data: rows.rows[0] });
  } catch {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /api/match/:matchId/claim  — sign a reward claim for on-chain redemption
matchRouter.post('/:matchId/claim', requireAuth, async (req, res) => {
  const { playerId } = req.player!;
  const { matchId }  = req.params;

  try {
    const rows = await db.query(
      'SELECT tokens_earned, rank, reward_claimed FROM match_results WHERE match_id = $1 AND player_id = $2',
      [matchId, playerId],
    );
    const match = rows.rows[0];
    if (!match) { res.status(404).json({ success: false, error: 'Match result not found' }); return; }
    if (match.reward_claimed) { res.status(409).json({ success: false, error: 'Reward already claimed' }); return; }

    // Sign the reward with the server private key so the smart contract can verify
    if (!config.web3.rewardSigner) {
      res.status(503).json({ success: false, error: 'Reward signing not configured' });
      return;
    }

    const signer   = new ethers.Wallet(config.web3.rewardSigner);
    const msgHash  = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'uint256', 'uint256'],
        [
          ethers.keccak256(ethers.toUtf8Bytes(matchId)),
          playerId,
          ethers.parseEther(match.tokens_earned),
          match.rank,
        ],
      ),
    );
    const signature = await signer.signMessage(ethers.getBytes(msgHash));

    // Mark as claimed in DB
    await db.query(
      'UPDATE match_results SET reward_claimed = true, reward_claimed_at = NOW() WHERE match_id = $1',
      [matchId],
    );
    // Update total_tokens_earned on player
    await db.query(
      `UPDATE players SET total_tokens_earned = total_tokens_earned + $1 WHERE id = $2`,
      [parseFloat(match.tokens_earned), playerId],
    );

    res.json({
      success: true,
      data: {
        matchId,
        playerId,
        amount: match.tokens_earned,
        rank:   match.rank,
        signature,
      },
    });
  } catch (err) {
    logger.error({ err }, 'Reward claim error');
    res.status(500).json({ success: false, error: 'Failed to process reward' });
  }
});

// GET /api/match/active  — check if player is in an active room
matchRouter.get('/active', requireAuth, async (_req, res) => {
  // WebSocket-driven — return null (client connects to WS to discover active room)
  res.json({ success: true, data: null });
});
