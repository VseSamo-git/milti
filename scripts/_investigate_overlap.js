import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  console.log('=== «Останкино» в БАЗЕ ===');
  const b = await sql`SELECT o.cadastral_no, o.title, o.address, round(o.area_sqm)::int area, o.origin, o.lat, o.lon
    FROM vitrina."База" v JOIN kosmos.objects o ON o.cadastral_no=v."Ключ"
    WHERE v."Название" ILIKE '%останкин%' OR o.address ILIKE '%останкин%' ORDER BY area DESC`;
  for (const r of b) console.log(`  [${r.origin||'реестр'}] «${r.title||'—'}» ${r.area||'?'}м² | ${r.address} | ${r.lat},${r.lon} | ${r.cadastral_no}`);

  console.log('\n=== «Останкино» НА ПРОВЕРКУ ===');
  const p = await sql`SELECT o.cadastral_no, o.title, o.address, round(o.area_sqm)::int area, o.origin, o.lat, o.lon
    FROM vitrina."На проверку" v JOIN kosmos.objects o ON o.cadastral_no=v."Ключ"
    WHERE v."Название" ILIKE '%останкин%' OR o.address ILIKE '%останкин%' ORDER BY area DESC`;
  for (const r of p) console.log(`  [${r.origin||'реестр'}] «${r.title||'—'}» ${r.area||'?'}м² | ${r.address} | ${r.lat},${r.lon} | ${r.cadastral_no}`);
  console.log(`\nВ Базе: ${b.length} | На проверку: ${p.length}`);
} finally { await sql.end({ timeout: 5 }); }
