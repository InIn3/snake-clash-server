// Backend-internal types (server-side representation of game state)

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
export type FoodType  = 'NORMAL' | 'POWER' | 'GOLDEN' | 'SPEED' | 'SHIELD';
export type GamePhase = 'WAITING' | 'COUNTDOWN' | 'PLAYING' | 'ENDED';

export interface Vec2 { x: number; y: number; }

export interface Snake {
  id: string;
  playerId: string;
  playerName: string;
  socketId: string;
  segments: Vec2[];
  direction: Direction;
  nextDirection: Direction;
  speed: number;
  length: number;
  score: number;
  skinId: string;
  alive: boolean;
  rank: number;
  boosting: boolean;
  invincible: boolean;
  invincibleUntil: number;
  boostDrainAccum: number;
  killedBy?: string;
  eliminatedAt?: number;
  survivalSeconds: number;
  spawnedAt: number;
  lastInputSeq: number;
  isBot?: boolean;
  aiNextTurnAt?: number;
}

export interface Food {
  id: string;
  x: number;
  y: number;
  type: FoodType;
  value: number;
  spawnedAt: number;
}

export interface GameRoom {
  id: string;
  phase: GamePhase;
  tick: number;
  startedAt: number;
  endsAt: number;
  snakes: Map<string, Snake>;
  foods: Map<string, Food>;
  eliminationOrder: string[];  // playerId[]
  playerCount: number;
  mode: 'CASUAL' | 'RANKED' | 'TOURNAMENT';
}

export interface Player {
  id: string;
  username: string;
  walletAddress?: string;
  activeSkinId: string;
  level: number;
  xp: number;
}

export interface MatchRecord {
  matchId: string;
  roomId: string;
  playerId: string;
  rank: number;
  score: number;
  length: number;
  duration: number;
  tokensEarned: string;
  xpEarned: number;
  playedAt: Date;
}
