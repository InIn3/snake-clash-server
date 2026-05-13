export const ARENA_WIDTH   = 4000;
export const ARENA_HEIGHT  = 4000;
export const CELL_SIZE     = 20;
export const SNAKE_SPEED   = 180;   // px/s
export const BOOST_SPEED   = 320;   // px/s while boosting
export const TICK_RATE     = 20;    // ticks per second
export const TICK_MS       = 1000 / TICK_RATE;
export const FOOD_COUNT    = 600;
export const INITIAL_LENGTH = 10;
export const SPAWN_INVINCIBLE_MS = 3000;
export const MATCH_DURATION_S   = 300; // 5 minutes

export const FOOD_VALUE: Record<string, number> = {
  NORMAL: 1, POWER: 3, GOLDEN: 10, SPEED: 1, SHIELD: 1,
};
export const SCORE_PER_FOOD: Record<string, number> = {
  NORMAL: 10, POWER: 30, GOLDEN: 100, SPEED: 15, SHIELD: 20,
};
export const FOOD_SPAWN_WEIGHT: Record<string, number> = {
  NORMAL: 70, POWER: 12, GOLDEN: 3, SPEED: 8, SHIELD: 7,
};

// Tokens awarded by placement (BigNumber string, 18 decimals = ETH-like)
export const TOKEN_REWARDS: Record<number, string> = {
  1: '100', 2: '60', 3: '40', 4: '25', 5: '15',
};
export const TOKEN_SURVIVAL_RATE = 0.05; // per second survived

export const HEAD_COLLISION_RADIUS = CELL_SIZE * 0.6;
export const FOOD_PICKUP_RADIUS    = CELL_SIZE * 0.9;
