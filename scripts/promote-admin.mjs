import pg from 'pg'

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error('Usage: npm run admin:promote -- user@example.com')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
try {
  const result = await pool.query(
    `update users
       set role = 'ADMIN', status = 'ACTIVE', updated_at = now()
     where lower(email) = $1
     returning id, email, role, status`,
    [email],
  )
  if (result.rowCount !== 1) throw new Error(`No user found for ${email}`)
  console.log(`Administrator enabled: ${result.rows[0].email}`)
} finally {
  await pool.end()
}
