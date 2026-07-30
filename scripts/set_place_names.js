// Проставить имена местам (НИИ и т.п.) в kosmos.places, найденные веб-поиском.
// Читает docs/found_place_names.json = [{place_id, name}]. Пишет только где name пусто.
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';

export async function setPlaceNames(registry, { apply = false } = {}) {
  const rows = JSON.parse(readFileSync('docs/found_place_names.json', 'utf8'))
    .filter((r) => r.place_id && r.name && String(r.name).trim())
    .map((r) => ({ id: String(r.place_id), name: String(r.name).trim().slice(0, 200) }));
  console.log(`имён мест к записи: ${rows.length}`);
  for (const r of rows) console.log(`  place:${r.id} → «${r.name}»`);
  if (!apply) { console.log('\n(dry-run: --apply чтобы записать)'); return { pending: rows.length }; }

  let set = 0;
  for (const r of rows) {
    const res = await registry.sql`
      UPDATE kosmos.places SET name = ${r.name}
      WHERE id = ${r.id} AND (name IS NULL OR trim(name)='') RETURNING id`;
    if (res.length) set++;
  }
  console.log(`\nпроставлено имён мест: ${set}`);
  return { set };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const registry = new Registry(loadConfig());
  try { await setPlaceNames(registry, { apply }); }
  finally { await registry.close(); }
}
