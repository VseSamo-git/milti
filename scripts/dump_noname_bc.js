// Выгрузка безымянных БЦ из «Базы» (для ручного/поискового дозаполнения названий).
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
import { writeFileSync } from 'node:fs';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
try {
  // те же БЦ, что попадают в «Базу», но без названия
  const rows = await sql`
    SELECT o.cadastral_no, round(o.area_sqm)::int area, o.floors, o.lat, o.lon, o.address
    FROM kosmos.objects o
    LEFT JOIN vitrina._last_verdict v ON v.object_id=o.id
    WHERE o.status='активен' AND o.origin IS NULL AND o.title IS NULL
      AND (v.verdict IS NULL OR v.verdict<>'отказ')
      AND (o.object_type='бц' OR o.arendator_matched)
      AND (o.arendator_matched OR o.area_sqm>=10000 OR o.area_sqm IS NULL)
    ORDER BY o.area_sqm DESC NULLS LAST`;
  console.log(`безымянных БЦ в Базе: ${rows.length}`);
  writeFileSync('docs/noname_bc.json', JSON.stringify(rows, null, 1));
  console.log('топ-30 по площади:');
  for (const r of rows.slice(0, 30)) console.log(`${r.area||'?'}м²\t${r.address}\t[${r.cadastral_no}]`);
} finally { await sql.end({ timeout: 5 }); }
