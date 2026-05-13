import { Pool } from 'pg';
import { config } from '../config';

const SCHEMA = `
-- Players
CREATE TABLE IF NOT EXISTS players (
  id               TEXT PRIMARY KEY,
  username         TEXT NOT NULL,
  wallet_address   TEXT UNIQUE,
  is_guest         BOOLEAN NOT NULL DEFAULT false,
  level            INT NOT NULL DEFAULT 1,
  xp               INT NOT NULL DEFAULT 0,
  total_matches    INT NOT NULL DEFAULT 0,
  wins             INT NOT NULL DEFAULT 0,
  best_score       INT NOT NULL DEFAULT 0,
  total_tokens_earned NUMERIC(20,6) NOT NULL DEFAULT 0,
  active_skin_id   TEXT NOT NULL DEFAULT 'default-blue',
  avatar_url       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Player stats
CREATE TABLE IF NOT EXISTS player_stats (
  player_id        TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  global_rank      INT NOT NULL DEFAULT 0,
  season_rank      INT NOT NULL DEFAULT 0,
  avg_score        NUMERIC(10,2) NOT NULL DEFAULT 0,
  avg_position     NUMERIC(5,2) NOT NULL DEFAULT 0,
  kill_count       INT NOT NULL DEFAULT 0,
  food_eaten       INT NOT NULL DEFAULT 0,
  distance_traveled BIGINT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Match results
CREATE TABLE IF NOT EXISTS match_results (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  match_id         TEXT NOT NULL,
  player_id        TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rank             INT NOT NULL,
  score            INT NOT NULL DEFAULT 0,
  length           INT NOT NULL DEFAULT 0,
  duration         INT NOT NULL DEFAULT 0,
  kills            INT NOT NULL DEFAULT 0,
  food_eaten       INT NOT NULL DEFAULT 0,
  tokens_earned    NUMERIC(20,6) NOT NULL DEFAULT 0,
  xp_earned        INT NOT NULL DEFAULT 0,
  reward_claimed   BOOLEAN NOT NULL DEFAULT false,
  mode             TEXT NOT NULL DEFAULT 'CASUAL',
  played_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_results_player ON match_results(player_id, played_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_results_match  ON match_results(match_id);

-- Inventory (NFT skins owned per player)
CREATE TABLE IF NOT EXISTS player_inventory (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  player_id        TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skin_id          TEXT NOT NULL,
  token_id         INT,
  acquired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, skin_id)
);

-- Season leaderboard cache
CREATE TABLE IF NOT EXISTS season_leaderboard (
  player_id        TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season           INT NOT NULL,
  total_score      BIGINT NOT NULL DEFAULT 0,
  rank             INT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_id, season)
);

-- Quests
CREATE TABLE IF NOT EXISTS quests (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL,
  type             TEXT NOT NULL,
  target           INT NOT NULL,
  reward_xp        INT NOT NULL DEFAULT 0,
  reward_tokens    NUMERIC(20,6) NOT NULL DEFAULT 0,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_quests (
  player_id        TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_id         TEXT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  progress         INT NOT NULL DEFAULT 0,
  completed        BOOLEAN NOT NULL DEFAULT false,
  claimed          BOOLEAN NOT NULL DEFAULT false,
  completed_at     TIMESTAMPTZ,
  PRIMARY KEY (player_id, quest_id)
);

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'UPCOMING',
  entry_fee        NUMERIC(20,6) NOT NULL DEFAULT 0,
  prize_pool       NUMERIC(20,6) NOT NULL DEFAULT 0,
  max_players      INT NOT NULL DEFAULT 100,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  tournament_id    TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id        TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score            INT NOT NULL DEFAULT 0,
  rank             INT,
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, player_id)
);
`;

async function migrate() {
  const pool = new Pool({
    connectionString: config.db.url,
    ssl: { rejectUnauthorized: false },
  });
  try {
    console.log('Running migrations...');
    await pool.query(SCHEMA);
    console.log('Migrations complete ✓');
  } finally {
    await pool.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
