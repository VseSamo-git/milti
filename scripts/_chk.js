import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
const R = 6371000, rad = (d) => d * Math.PI / 180;
const dm = (a, b, c, d) => { const x = rad(c - a), y = rad(d - b); const s = Math.sin(x / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
try {
  const [na] = await sql`SELECT count(*)::int n FROM kosmos.objects WHERE title IS NOT NULL AND (address IS NULL OR trim(address)='')`;
  console.log('B) с именем без адреса:', na.n);
  const baza = await sql`SELECT o.cadastral_no, o.lat, o.lon FROM vitrina."База" v JOIN kosmos.objects o ON o.cadastral_no=v."Ключ" WHERE o.lat IS NOT NULL`;
  const pts = await sql`SELECT lat,lon FROM kosmos.our_points WHERE lat IS NOT NULL UNION ALL SELECT lat,lon FROM kosmos.closed_points WHERE lat IS NOT NULL`;
  let near = 0;
  for (const b of baza) { for (const p of pts) { if (dm(b.lat, b.lon, p.lat, p.lon) <= 30) { near++; break; } } }
  console.log('C2) объектов Базы в ≤30м от точки Милти (должно 0):', near, '| точек Милти:', pts.length);
} finally { await sql.end({ timeout: 5 }); }
