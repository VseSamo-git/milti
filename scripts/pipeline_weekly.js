/**
 * Воскресный конвейер: обновить то, что меняется за неделю, и пересобрать
 * витрину. Один прогон = свежая база к утру понедельника, как просил Дима.
 *
 * ЧТО ОБНОВЛЯЕТСЯ ЕЖЕНЕДЕЛЬНО:
 *   1. Конкуренты (store-locator'ы + вторичные OSM) — сети открываются и
 *      закрываются, это главное живое. Заодно детекция «возможно закрылась».
 *   2. Адреса новым точкам: сперва реестр Москвы, затем Nominatim для МО.
 *   3. Пересборка витрины в NocoDB.
 *
 * ЧТО СЮДА НЕ ВХОДИТ (меняется редко, отдельным запуском):
 *   - перечень 700-ПП (build_baseline) — новая редакция раз в месяцы;
 *   - справочник зданий (build_addresses) — почти статичен;
 *   - обогащение площадями из НСПД — разовый бэкофилл;
 *   - ВУЗы/НИИ (build_places education) — почти статичны.
 *
 * СТАДИИ ИЗОЛИРОВАНЫ: падение одной не роняет остальные, но громко попадает
 * в сводку и в ненулевой код возврата. Сводку дальше заберёт Telegram-дайджест.
 *
 * Запуск:
 *   node run.js ./scripts/pipeline_weekly.js
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { stageCompetitors } from './build_places.js';
import { linkAddresses } from './link_addresses.js';
import { linkNominatim } from './link_nominatim.js';
import { buildVitrina } from './build_vitrina.js';

const cfg = loadConfig();

// Снимок ключевых чисел — чтобы показать, что изменилось за прогон.
async function snapshot(registry) {
  const [c] = await registry.sql`SELECT
    count(*) FILTER (WHERE kind='конкурент')::int competitors,
    count(*) FILTER (WHERE kind='конкурент' AND status='кандидат_на_закрытие')::int closing
    FROM kosmos.places`;
  const [bc] = await registry.sql`SELECT count(*)::int n FROM kosmos.objects
    WHERE annex=1 AND title IS NOT NULL AND area_sqm>=10000`;
  return { competitors: c.competitors, closing: c.closing, bc: bc.n };
}

const summary = { errors: [] };

async function step(name, fn) {
  console.log(`\n===== ${name} =====`);
  try {
    await fn();
  } catch (e) {
    console.log(`СТАДИЯ УПАЛА: ${e.message}`);
    summary.errors.push({ name, error: e.message });
  }
}

let before = null;
let after = null;

const registry = new Registry(cfg);
try {
  before = await snapshot(registry);
  await step('Конкуренты', () => stageCompetitors(registry));
  await step('Адреса — реестр Москвы', () => linkAddresses(registry, { maxMeters: 100 }));
  await step('Адреса — Nominatim (МО)', () => linkNominatim(registry));
  after = await snapshot(registry);
} finally {
  await registry.close();
}

// Витрина — своим подключением (buildVitrina сам открывает и закрывает).
await step('Витрина NocoDB', () => buildVitrina(cfg));

const delta = (a, b) => `${b}${b - a >= 0 ? ` (+${b - a})` : ` (${b - a})`}`;
console.log('\n================ СВОДКА ================');
if (before && after) {
  console.log(`БЦ с названием ≥10k:  ${before.bc} → ${delta(before.bc, after.bc)}`);
  console.log(`Конкуренты:           ${before.competitors} → ${delta(before.competitors, after.competitors)}`);
  console.log(`Возможно закрылись:   ${after.closing}`);
}
if (summary.errors.length) {
  console.log(`\nОШИБКИ (${summary.errors.length}) — витрина могла собраться неполной:`);
  for (const e of summary.errors) console.log(`  • ${e.name}: ${e.error}`);
  process.exitCode = 1;
} else {
  console.log('\nвсе стадии прошли чисто');
}
