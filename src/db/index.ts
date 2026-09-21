import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

let pool: pg.Pool | undefined

export function getPool(): pg.Pool {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not configured')

  pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : false,
  })
  return pool
}

export function getDb() {
  return drizzle(getPool(), { schema })
}

export type Database = ReturnType<typeof getDb>
