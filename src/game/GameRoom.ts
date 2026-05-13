import { v4 as uuid } from 'uuid';
import type { Server, Socket } from 'socket.io';
import type { Snake, Food, GameRoom as IGameRoom, Direction, MatchRecord, Player } from '../types';
import { SnakePhysics } from './SnakePhysics';
import { FoodManager } from './FoodManager';
import { CollisionDetector } from './CollisionDetector';
import { db } from '../db/client';
import { logger } from '../utils/logger';
import {
  TICK_MS, INITIAL_LENGTH, SPAWN_INVINCIBLE_MS, ARENA_WIDTH, ARENA_HEIGHT,
  SCORE_PER_FOOD, FOOD_PICKUP_RADIUS, TOKEN_REWARDS, TOKEN_SURVIVAL_RATE,
  MATCH_DURATION_S,
} from './constants';
import { config } from '../config';

const CELL = 20; // segment size
const BOT_TARGET_PLAYERS = 6;
const BOT_SKINS = ['default-blue', 'default-green', 'default-purple', 'fire-trail'];

export class GameRoom {
  readonly id: string;
  private io: Server;
  private snakes  = new Map<string, Snake>();
  private food    = new FoodManager();
  private phase: IGameRoom['phase'] = 'WAITING';
  private tick = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private startedAt   = 0;
  private endsAt      = 0;
  private eliminationOrder: string[] = [];
  readonly mode: IGameRoom['mode'];
  private maxPlayers: number;

  // Socket → playerId map for quick lookup
  private socketToPlayer = new Map<string, string>();

  constructor(io: Server, mode: IGameRoom['mode'] = 'CASUAL', maxPlayers = config.game.maxPlayers) {
    this.id         = uuid();
    this.io         = io;
    this.mode       = mode;
    this.maxPlayers = maxPlayers;
  }

  // ── Player join / leave ───────────────────────────────────

  addPlayer(socket: Socket, player: Player, skinId: string): boolean {
    if (this.phase !== 'WAITING' || this.snakes.size >= this.maxPlayers) return false;

    const spawnPos = this._randomSpawn();
    const snake: Snake = {
      id:               uuid(),
      playerId:         player.id,
      playerName:       player.username,
      socketId:         socket.id,
      segments:         this._buildInitialSegments(spawnPos),
      direction:        'RIGHT',
      nextDirection:    'RIGHT',
      speed:            180,
      length:           INITIAL_LENGTH,
      score:            0,
      skinId,
      alive:            true,
      rank:             0,
      boosting:         false,
      invincible:       true,
      invincibleUntil:  Date.now() + SPAWN_INVINCIBLE_MS,
      boostDrainAccum:  0,
      survivalSeconds:  0,
      spawnedAt:        Date.now(),
      lastInputSeq:     -1,
    };

    this.snakes.set(player.id, snake);
    this.socketToPlayer.set(socket.id, player.id);

    socket.join(this.id);
    this._ensureBots();

    socket.emit('server:joined', {
      playerId: player.id,
      roomId:   this.id,
      state:    this._serializeState(),
    });

    // Broadcast updated player count to all in room
    this.io.to(this.id).emit('server:playerJoined', {
      playerId:    player.id,
      playerName:  player.username,
      playerCount: this.snakes.size,
    });

    logger.info({ roomId: this.id, playerId: player.id }, 'Player joined room');

    // Auto-start once min players reached (with countdown)
    if (this.snakes.size >= config.game.minStartPlayers && this.phase === 'WAITING') {
      this._startCountdown(5);
    }

    return true;
  }

  removePlayer(socketId: string) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return;
    this.socketToPlayer.delete(socketId);

    const snake = this.snakes.get(playerId);
    if (snake) {
      snake.alive = false;
      if (this.phase === 'PLAYING') {
        this._eliminate(playerId, undefined, true);
      }
    }

    logger.info({ roomId: this.id, playerId }, 'Player left room');
  }

  // ── Input handling ────────────────────────────────────────

  handleDirection(socketId: string, direction: Direction, seq: number) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return;
    const snake = this.snakes.get(playerId);
    if (!snake || !snake.alive) return;

    // Anti-cheat: ignore old/duplicate sequence numbers
    if (seq <= snake.lastInputSeq) return;
    snake.lastInputSeq = seq;

    snake.nextDirection = SnakePhysics.validateDirection(snake.direction, direction);
  }

  handleBoost(socketId: string, active: boolean) {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return;
    const snake = this.snakes.get(playerId);
    if (!snake || !snake.alive) return;
    snake.boosting = active && snake.length > 5;
  }

  // ── Game loop ─────────────────────────────────────────────

  private _startCountdown(seconds: number) {
    this.phase = 'COUNTDOWN';
    let remaining = seconds;

    const tick = () => {
      this.io.to(this.id).emit('server:countdown', { seconds: remaining });
      if (remaining === 0) {
        this._startGame();
        return;
      }
      remaining--;
      this.countdownTimer = setTimeout(tick, 1000);
    };
    tick();
  }

  private _startGame() {
    this.phase     = 'PLAYING';
    this.startedAt = Date.now();
    this.endsAt    = this.startedAt + MATCH_DURATION_S * 1000;
    this.tick      = 0;

    this.io.to(this.id).emit('server:start', this._serializeState());

    this.tickTimer = setInterval(() => this._gameTick(), TICK_MS);

    // Schedule forced end
    setTimeout(() => {
      if (this.phase === 'PLAYING') this._endGame();
    }, MATCH_DURATION_S * 1000);

    logger.info({ roomId: this.id, players: this.snakes.size }, 'Game started');
  }

  private _gameTick() {
    if (this.phase !== 'PLAYING') return;
    this.tick++;

    const now = Date.now();
    const foodConsumed: string[] = [];
    const foodSpawned: Food[]    = [];
    const snakePatch: Record<string, object> = {};

    // Collect all collision events before eliminating (prevents double-kills)
    const pendingElim = new Map<string, string | undefined>(); // victimId → killedBy

    // Process each snake
    for (const [playerId, snake] of this.snakes) {
      if (!snake.alive) continue;
      if (snake.isBot) this._updateBotDirection(snake, now);

      // Remove invincibility
      if (snake.invincible && now > snake.invincibleUntil) {
        snake.invincible = false;
      }

      // Apply direction change
      snake.direction = snake.nextDirection;

      // Check food pickup BEFORE moving
      const head = snake.segments[0]!;
      const eaten = this.food.checkPickups(head, FOOD_PICKUP_RADIUS);
      if (eaten) {
        this.food.consume(eaten.id);
        foodConsumed.push(eaten.id);
        snake.score += SCORE_PER_FOOD[eaten.type] ?? 10;
      }

      // Move snake
      const { head: newHead, poppedTail } = SnakePhysics.move(snake, !!eaten);

      // Boost drain
      if (snake.boosting) {
        SnakePhysics.applyBoostDrain(snake, TICK_MS);
      }

      // Increment survival time
      snake.survivalSeconds += TICK_MS / 1000;

      // Collision detection (Slither.io rules — collect events, process after loop)
      if (!snake.invincible) {
        const events = CollisionDetector.check(snake, this.snakes);
        for (const evt of events) {
          if (!pendingElim.has(evt.victimId)) {
            pendingElim.set(evt.victimId, evt.killedBy);
          }
        }
      }

      // Build patch for this snake
      snakePatch[playerId] = {
        head:      newHead,
        tail:      eaten ? undefined : poppedTail,
        direction: snake.direction,
        score:     snake.score,
        length:    snake.length,
        boosting:  snake.boosting,
      };
    }

    // Process all eliminations — victims' dropped food goes into foodSpawned
    for (const [victimId, killedBy] of pendingElim) {
      const dropped = this._eliminate(victimId, killedBy);
      foodSpawned.push(...dropped);
    }

    // Replenish food
    const newFood = this.food.replenish();
    foodSpawned.push(...newFood);

    // Broadcast state delta (much smaller than full state)
    const update = {
      snakes: snakePatch,
      foods: {
        consumed: foodConsumed.length ? foodConsumed : undefined,
        spawned:  foodSpawned.length  ? foodSpawned  : undefined,
      },
      tick: this.tick,
    };
    this.io.to(this.id).emit('server:state', update);

    // Broadcast leaderboard every 20 ticks (~1 second)
    if (this.tick % 20 === 0) {
      this._broadcastLeaderboard();
    }

    // Check game-over conditions — require at least 5s of play before ending
    const aliveCount = [...this.snakes.values()].filter(s => s.alive).length;
    const realAliveCount = [...this.snakes.values()].filter(s => s.alive && !s.isBot).length;
    const elapsedMs = Date.now() - this.startedAt;
    if (aliveCount === 0 || realAliveCount === 0) {
      setTimeout(() => this._endGame(), 500);
    } else if (aliveCount <= 1 && this.snakes.size > 1 && elapsedMs >= 5000) {
      setTimeout(() => this._endGame(), 2000);
    }
  }

  // ── Elimination ───────────────────────────────────────────

  private _eliminate(playerId: string, killedBy?: string, disconnected = false): Food[] {
    const snake = this.snakes.get(playerId);
    if (!snake || !snake.alive) return [];

    snake.alive = false;
    snake.killedBy     = killedBy;
    snake.eliminatedAt = Date.now();

    // Drop food along body (Slither.io style — others rush in to eat the mass)
    const droppedFood: Food[] = [];
    const step = Math.max(2, Math.floor(snake.segments.length / 25)); // max ~25 pellets
    for (let i = 0; i < snake.segments.length; i += step) {
      const seg = snake.segments[i];
      if (!seg) continue;
      const f = this.food.spawnOne({
        x: seg.x + (Math.random() - 0.5) * 24,
        y: seg.y + (Math.random() - 0.5) * 24,
      });
      droppedFood.push(f);
    }

    const aliveCount = [...this.snakes.values()].filter(s => s.alive).length;
    const rank = aliveCount + 1;
    snake.rank = rank;
    this.eliminationOrder.unshift(playerId);

    this.io.to(this.id).emit('server:eliminated', {
      playerId, killedBy, rank, disconnected,
    });

    logger.debug({ roomId: this.id, playerId, killedBy, rank }, 'Player eliminated');
    return droppedFood;
  }

  // ── End game ──────────────────────────────────────────────

  private async _endGame() {
    if (this.phase === 'ENDED') return;
    this.phase = 'ENDED';

    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.countdownTimer) { clearTimeout(this.countdownTimer); this.countdownTimer = null; }

    // Assign final ranks
    const alive = [...this.snakes.values()].filter(s => s.alive).sort((a, b) => b.score - a.score);
    alive.forEach((s, i) => { s.rank = i + 1; });

    const allPlayers = [...this.snakes.values()].sort((a, b) => a.rank - b.rank);
    const realPlayers = allPlayers.filter(snake => !snake.isBot);
    const results: MatchRecord[] = realPlayers.map(snake => ({
      matchId:       uuid(),
      roomId:        this.id,
      playerId:      snake.playerId,
      rank:          snake.rank,
      score:         snake.score,
      length:        snake.length,
      duration:      Math.floor(snake.survivalSeconds),
      tokensEarned:  this._calcTokens(snake.rank, snake.survivalSeconds),
      xpEarned:      this._calcXP(snake.rank, snake.score),
      playedAt:      new Date(),
    }));

    // Persist results
    try {
      await this._saveResults(results);
    } catch (err) {
      logger.error({ err }, 'Failed to save match results');
    }

    // Build per-player result map and emit
    const resultMap = new Map(results.map(r => [r.playerId, r]));
    for (const snake of allPlayers) {
      const socketId = snake.socketId;
      const myResult = resultMap.get(snake.playerId);
      if (!snake.isBot) this.io.to(socketId).emit('server:ended', { results, myResult });
    }

    logger.info({ roomId: this.id, playerCount: allPlayers.length, savedResults: results.length }, 'Game ended');
  }

  // ── Helpers ───────────────────────────────────────────────

  private _broadcastLeaderboard() {
    const entries = [...this.snakes.values()]
      .sort((a, b) => b.score - a.score)
      .map((s, i) => ({
        rank:       s.rank > 0 ? s.rank : i + 1,
        playerId:   s.playerId,
        playerName: s.playerName,
        score:      s.score,
        length:     s.length,
        alive:      s.alive,
      }));
    this.io.to(this.id).emit('server:leaderboard', { entries });
  }

  private _calcTokens(rank: number, survivalSecs: number): string {
    const base = parseFloat(TOKEN_REWARDS[rank] ?? TOKEN_REWARDS[Object.keys(TOKEN_REWARDS).length] ?? '1');
    const survival = survivalSecs * TOKEN_SURVIVAL_RATE;
    return (base + survival).toFixed(2);
  }

  private _calcXP(rank: number, score: number): number {
    const rankBonus = Math.max(0, (50 - rank) * 10);
    return Math.floor(score * 0.1 + rankBonus);
  }

  private async _saveResults(results: MatchRecord[]) {
    for (const r of results) {
      await db.query(
        `INSERT INTO match_results
         (match_id, room_id, player_id, rank, score, length, duration_seconds,
          tokens_earned, xp_earned, played_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [r.matchId, r.roomId, r.playerId, r.rank, r.score, r.length,
         r.duration, r.tokensEarned, r.xpEarned, r.playedAt],
      );
      // Update player stats
      await db.query(
        `UPDATE players
         SET total_matches = total_matches + 1,
             wins          = wins + $1,
             best_score    = GREATEST(best_score, $2),
             xp            = xp + $3,
             updated_at    = NOW()
         WHERE id = $4`,
        [r.rank === 1 ? 1 : 0, r.score, r.xpEarned, r.playerId],
      );
    }
  }

  private _buildInitialSegments(head: { x: number; y: number }) {
    const segs = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      segs.push({ x: head.x - i * CELL, y: head.y });
    }
    return segs;
  }

  private _ensureBots() {
    if (this.phase !== 'WAITING') return;
    const realPlayers = [...this.snakes.values()].filter(s => !s.isBot).length;
    if (realPlayers === 0) return;
    const target = Math.min(BOT_TARGET_PLAYERS, this.maxPlayers);
    const botsToAdd = Math.max(0, target - this.snakes.size);
    for (let i = 0; i < botsToAdd; i++) this._addBot();
  }

  private _addBot() {
    const botNumber = [...this.snakes.values()].filter(s => s.isBot).length + 1;
    const playerId = `bot-${this.id.slice(0, 8)}-${botNumber}`;
    const spawnPos = this._randomSpawn();
    const botAddress = this._makeBotAddress();
    const name = this._shortWallet(botAddress);
    const skinId = BOT_SKINS[(botNumber - 1) % BOT_SKINS.length]!;
    const snake: Snake = {
      id:              uuid(),
      playerId,
      playerName:      name,
      socketId:        `bot:${playerId}`,
      segments:        this._buildInitialSegments(spawnPos),
      direction:       'RIGHT',
      nextDirection:   'RIGHT',
      speed:           150,
      length:          INITIAL_LENGTH,
      score:           0,
      skinId,
      alive:           true,
      rank:            0,
      boosting:        false,
      invincible:      true,
      invincibleUntil: Date.now() + SPAWN_INVINCIBLE_MS,
      boostDrainAccum: 0,
      survivalSeconds: 0,
      spawnedAt:       Date.now(),
      lastInputSeq:    -1,
      isBot:           true,
      botTraceId:      `${playerId}:${botAddress}`,
      aiNextTurnAt:    0,
    };
    this.snakes.set(playerId, snake);
    this.io.to(this.id).emit('server:playerJoined', {
      playerId,
      playerName: name,
      playerCount: this.snakes.size,
      isBot: true,
    });
  }

  private _makeBotAddress() {
    return `0x${(uuid() + uuid()).replace(/-/g, '').slice(0, 40)}`;
  }

  private _shortWallet(address: string) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  private _updateBotDirection(snake: Snake, now: number) {
    if ((snake.aiNextTurnAt ?? 0) > now) return;
    snake.aiNextTurnAt = now + 250 + Math.random() * 500;

    const head = snake.segments[0];
    if (!head) return;
    const margin = 180;
    let desired: Direction | null = null;

    if (head.x < margin) desired = 'RIGHT';
    else if (head.x > ARENA_WIDTH - margin) desired = 'LEFT';
    else if (head.y < margin) desired = 'DOWN';
    else if (head.y > ARENA_HEIGHT - margin) desired = 'UP';
    else {
      const food = this._nearestFood(head);
      if (food) {
        const dx = food.x - head.x;
        const dy = food.y - head.y;
        desired = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'RIGHT' : 'LEFT')
          : (dy > 0 ? 'DOWN' : 'UP');
      }
    }

    if (!desired || Math.random() < 0.15) {
      const dirs: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
      desired = dirs[Math.floor(Math.random() * dirs.length)]!;
    }

    snake.nextDirection = SnakePhysics.validateDirection(snake.direction, desired);
    snake.boosting = false;
  }

  private _nearestFood(head: { x: number; y: number }): Food | null {
    let nearest: Food | null = null;
    let bestDist = Infinity;
    for (const food of Object.values(this.food.serialize())) {
      const dist = (food.x - head.x) ** 2 + (food.y - head.y) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        nearest = food;
      }
    }
    return nearest;
  }

  private _randomSpawn() {
    const margin = 200;
    return {
      x: margin + Math.random() * (ARENA_WIDTH  - margin * 2),
      y: margin + Math.random() * (ARENA_HEIGHT - margin * 2),
    };
  }

  private _serializeState() {
    const snakes: Record<string, object> = {};
    this.snakes.forEach((s, id) => {
      snakes[id] = {
        id: s.id, playerId: s.playerId, playerName: s.playerName,
        segments: s.segments, direction: s.direction,
        speed: s.speed, length: s.length, score: s.score,
        skin: { id: s.skinId }, alive: s.alive, rank: s.rank,
        boosting: s.boosting, invincible: s.invincible, isBot: !!s.isBot,
      };
    });
    return {
      roomId:      this.id,
      phase:       this.phase,
      tick:        this.tick,
      startedAt:   this.startedAt,
      endsAt:      this.endsAt,
      snakes,
      foods:       this.food.serialize(),
      arenaBounds: { width: ARENA_WIDTH, height: ARENA_HEIGHT },
      playerCount: this.snakes.size,
      aliveCount:  [...this.snakes.values()].filter(s => s.alive).length,
    };
  }

  // ── Public accessors ──────────────────────────────────────

  isFull()        { return this.snakes.size >= this.maxPlayers; }
  isEmpty()       { return [...this.snakes.values()].every(s => s.isBot); }
  getPhase()      { return this.phase; }
  getPlayerCount(){ return this.snakes.size; }
  getRoomId()     { return this.id; }

  destroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
  }
}
