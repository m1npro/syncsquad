import { neon } from '@neondatabase/serverless';

/** Public readiness probe. Exposes connectivity only, never credentials or room data. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ ok: false, database: 'not_configured' });
  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`SELECT 1 FROM sync_rooms LIMIT 1`;
    return res.status(200).json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('SyncSquad health failure:', error?.code || error?.name || 'unknown');
    return res.status(503).json({ ok: false, database: 'unavailable' });
  }
}
