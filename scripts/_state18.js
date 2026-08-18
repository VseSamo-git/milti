import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  const c = await sql`SELECT column_name FROM information_schema.columns
                       WHERE table_schema='kosmos' AND table_name='verdicts'`;
  console.log('verdicts columns:', c.map(r => r.column_name).join(', '));
  console.log('024 применена (entity_key):', c.some(r => r.column_name === 'entity_key'));
  const v = await sql`SELECT table_name FROM information_schema.views WHERE table_schema='vitrina' ORDER BY 1`;
  console.log('vitrina views:', v.map(r => r.table_name).join(', '));
  const verd = await sql`SELECT verdict, count(*)::int n FROM kosmos.verdicts GROUP BY 1`;
  console.table(verd);
} finally { await sql.end({ timeout: 5 }); }
