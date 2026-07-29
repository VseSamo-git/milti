/** Разовая диагностика мусора в ВУЗ/НИИ/конкурентах (kosmos.places). Только чтение. */
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';

const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });

// Признаки мусора: остановки, маршруты, платформы, пустые/служебные имена.
const GARBAGE = /(автобус|маршрут|остановк|платформ|трамва|троллейбус|станци|метро|\bстоп\b|bus|route|stop|платф)/i;

try {
  const counts = await sql`SELECT kind, count(*) FROM kosmos.places GROUP BY kind ORDER BY kind`;
  console.log('=== по типам ===');
  console.table(counts);

  for (const k of ['нии', 'вуз', 'колледж']) {
    const rows = await sql`SELECT name, source, address FROM kosmos.places WHERE kind = ${k} ORDER BY name`;
    const garbage = rows.filter((r) => !r.name || GARBAGE.test(r.name));
    console.log(`\n=== ${k}: всего ${rows.length}, подозрительных ${garbage.length} ===`);
    for (const r of garbage.slice(0, 40)) console.log(`  ⚠ «${r.name}» [${r.source}] ${r.address || ''}`);
    if (k === 'нии') {
      console.log('  --- все имена нии (для глаз) ---');
      for (const r of rows) console.log(`   • ${r.name || '(без имени)'}`);
    }
  }

  // Конкуренты: разложить по сетям — нет ли левых
  const chains = await sql`SELECT chain, count(*), count(*) FILTER (WHERE status='кандидат_на_закрытие') closing
    FROM kosmos.places WHERE kind='конкурент' GROUP BY chain ORDER BY count(*) DESC`;
  console.log('\n=== конкуренты по сетям ===');
  console.table(chains);
} finally {
  await sql.end({ timeout: 5 });
}
