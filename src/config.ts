import dotenv from 'dotenv';
dotenv.config();

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  env:  optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '4001'), 10),

  jwt: {
    secret:         optional('SNAKE_JWT_SECRET', 'snake-clash-dev-secret-change-in-prod'),
    expiresIn:      optional('JWT_EXPIRES_IN', '7d'),
    refreshExpires: optional('JWT_REFRESH_EXPIRES', '30d'),
  },

  db: {
    url:      optional('SNAKE_DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/snake_clash'),
    poolMax:  parseInt(optional('DB_POOL_MAX', '20'), 10),
    poolIdle: parseInt(optional('DB_POOL_IDLE_MS', '10000'), 10),
  },

  redis: {
    url:   optional('UPSTASH_REDIS_REST_URL', ''),
    token: optional('UPSTASH_REDIS_REST_TOKEN', ''),
  },

  game: {
    tickRate:        parseInt(optional('GAME_TICK_RATE', '20'), 10),
    maxPlayers:      parseInt(optional('MAX_PLAYERS_PER_ROOM', '50'), 10),
    minStartPlayers: parseInt(optional('MIN_START_PLAYERS', '1'), 10),
    arenaWidth:      parseInt(optional('ARENA_WIDTH', '4000'), 10),
    arenaHeight:     parseInt(optional('ARENA_HEIGHT', '4000'), 10),
    matchDuration:   parseInt(optional('MATCH_DURATION_S', '300'), 10),
  },

  web3: {
    rpcUrl:          optional('BASE_SEPOLIA_RPC_URL', 'https://sepolia.base.org'),
    chainId:         parseInt(optional('CHAIN_ID', '84532'), 10),
    rewardSigner:    optional('SNAKE_REWARD_SIGNER_PRIVATE_KEY', ''),
    rewardsContract: optional('NEXT_PUBLIC_SNAKE_REWARDS_CONTRACT', ''),
    tokenContract:   optional('NEXT_PUBLIC_SNAKE_TOKEN_CONTRACT', ''),
    nftContract:     optional('NEXT_PUBLIC_SNAKE_NFT_CONTRACT', ''),
  },

  rateLimit: {
    windowMs: parseInt(optional('RATE_LIMIT_WINDOW_MS', '60000'), 10),
    max:      parseInt(optional('RATE_LIMIT_MAX', '100'), 10),
  },

  cors: {
    origins: optional('CORS_ORIGINS', 'http://localhost:3000').split(','),
  },
} as const;

export type Config = typeof config;
