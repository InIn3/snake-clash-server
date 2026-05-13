import { Pool, type PoolClient } from 'pg';
import { config } from '../config';

const pool = new Pool({
  connectionString: config.db.url,
  max:              config.db.poolMax,
  idleTimeoutMillis: config.db.poolIdle,
  connectionTimeoutMillis: 5000,
  ssl: config.env === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export const db = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (text: string, params?: unknown[]): Promise<any> => pool.query(text, params),

  transaction: async <T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  getClient: () => pool.connect(),
  end:       () => pool.end(),
};

export type DB = typeof db;
