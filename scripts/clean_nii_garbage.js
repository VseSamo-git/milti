/**
 * Чистка машинного мусора в НИИ: транспортные маршруты OSM
 * («Автобус 4: НИИОХ => Станция Мытищи») попали в kind='нии', т.к. имя
 * содержит подстроку «НИИ». Источник уже поправлен (isResearchInstitute),
 * но ранее влитые строки надо убрать. Удаляем только машинные записи —
 * вердиктов человека тут нет.
 *
 * Запуск: node run.js ./scripts/clean_nii_garbage.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';

const apply = process.argv.includes('--apply');
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });

const PAT = '^\\s*(автобус|маршрут|трамвай|троллейбус|электробус)\\M.*(=>|→|:)';

try {
  const hits = await sql`
    SELECT id, name FROM kosmos.places
    WHERE kind = 'нии' AND name ~* ${PAT} ORDER BY name`;
  console.log(`маршрутов-мусора в НИИ: ${hits.length}`);
  for (const h of hits) console.log(`  ✗ ${h.name} [id ${h.id}]`);

  if (!apply) { console.log('\n(dry-run: добавь --apply чтобы удалить)'); }
  else {
    const del = await sql`DELETE FROM kosmos.places WHERE kind='нии' AND name ~* ${PAT} RETURNING id`;
    console.log(`\nудалено: ${del.length}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
