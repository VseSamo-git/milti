import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  const s = await sql`SELECT status, count(*)::int, count(*) FILTER (WHERE origin IS NOT NULL)::int ext FROM kosmos.objects GROUP BY status ORDER BY 2 DESC`;
  console.table(s);
} finally { await sql.end({ timeout: 5 }); }
