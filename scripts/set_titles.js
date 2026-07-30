/**
 * Проставить названия БЦ, найденные веб-поиском (воркфлоу bc-titles-lookup).
 *
 * Читает docs/found_titles.json = [{cadastral_no, name}, ...] и пишет title
 * ТОЛЬКО там, где его ещё нет (title IS NULL) — человеческое/2ГИС-название
 * не затираем. Провенанс: title_source='интернет-поиск'.
 *
 * Запуск: node run.js ./scripts/set_titles.js [--apply]
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';

export async function setTitles(registry, { apply = false } = {}) {
  const rows = JSON.parse(readFileSync('docs/found_titles.json', 'utf8'))
    .filter((r) => r.cadastral_no && r.name && String(r.name).trim())
    .map((r) => ({ cad: r.cadastral_no, name: String(r.name).trim().slice(0, 200) }));
  console.log(`названий к записи: ${rows.length}`);
  for (const r of rows.slice(0, 15)) console.log(`  ${r.cad} → «${r.name}»`);

  if (!apply) { console.log('\n(dry-run: --apply чтобы записать)'); return { pending: rows.length }; }

  let set = 0;
  for (const r of rows) {
    const res = await registry.sql`
      UPDATE kosmos.objects SET title = ${r.name}, title_source = 'интернет-поиск'
      WHERE cadastral_no = ${r.cad} AND title IS NULL
      RETURNING cadastral_no`;
    if (res.length) set++;
  }
  console.log(`\nпроставлено названий: ${set} (пропущены те, где title уже был)`);
  return { set };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const registry = new Registry(loadConfig());
  try { await setTitles(registry, { apply }); }
  finally { await registry.close(); }
}
