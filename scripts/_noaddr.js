import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  const [c] = await sql`SELECT count(*)::int n,
     count(*) FILTER (WHERE lat IS NOT NULL)::int with_coords
     FROM kosmos.objects WHERE title IS NOT NULL AND (address IS NULL OR trim(address)='')`;
  console.log('объектов с именем, но без адреса:', c.n, '| из них с координатами:', c.with_coords);
  const r = await sql`SELECT cadastral_no, title, origin, lat, lon
     FROM kosmos.objects WHERE title IS NOT NULL AND (address IS NULL OR trim(address)='')
     ORDER BY area_sqm DESC NULLS LAST LIMIT 30`;
  for (const x of r) console.log(` [${x.origin || 'реестр'}] «${x.title}» ${x.lat ? x.lat + ',' + x.lon : '(без коорд)'} ${x.cadastral_no}`);
} finally { await sql.end({ timeout: 5 }); }
