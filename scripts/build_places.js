/**
 * Сбор точек OSM: конкуренты, ВУЗы, НИИ.
 *
 * Отдельно от build_baseline: эти списки не зависят от перечня 700-ПП
 * и от Росреестра. Конкуренты обновляются еженедельно (они шевелятся),
 * ВУЗы и НИИ — почти статичны.
 *
 * 2ГИС не нужен. Всё из OpenStreetMap, ODbL, бесплатно.
 *
 * Запуск:
 *   node run.js ./scripts/build_places.js competitors
 *   node run.js ./scripts/build_places.js education
 *   node run.js ./scripts/build_places.js all
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { OSM_ATTRIBUTION } from '../src/lib/overpass.js';
import { fetchAllCompetitors } from '../src/sources/competitors.js';
import { fetchResearchInstitutes, fetchUniversities, SOURCE as SRC_EDU } from '../src/sources/education.js';

// Сети без первоисточника: свой store-locator за анти-ботом или отсутствует.
// Их НЕ собираем автоматически (обход защиты не встраиваем) и честно называем,
// чтобы «нет данных» не читалось как «сеть исчезла».
const CHAINS_NO_SOURCE = ['drinkit', 'здрасте', 'parle market'];

async function stageCompetitors(registry) {
  console.log('=== КОНКУРЕНТЫ (store-locators сетей) ===');

  // Разовая чистка данных из дискредитированного источника (OSM: покрытие
  // 4–141%). Не пометка «закрыто», а удаление мусора — по решению 2026-07-20.
  const purged = await registry.deleteCompetitorsFromSource('osm_competitors');
  if (purged) console.log(`удалено старых OSM-точек: ${purged}`);

  const { points, failed, coverage } = await fetchAllCompetitors({
    onProgress: (e) => {
      if (e.error) console.log(`   ${e.chain}: УПАЛ — ${e.error.message.slice(0, 40)}`);
      else if (e.moscow === null) console.log(`   ${e.chain}: СЛОМАН — ${e.verdict.reason}`);
      else console.log(`   ${e.chain}: Москва ${e.moscow}  (разбор ${e.verdict.reason})`);
    },
  });

  const written = await registry.upsertPlaces(points.map((p) => ({ ...p, kind: 'конкурент' })));
  console.log(`записано точек: ${written}`);

  // Пометка «кандидат на закрытие» — ТОЛЬКО при полном обходе. Сломанный
  // парсер (канарейка) попадает в failed; при этом целую сеть нельзя объявить
  // закрытой из-за сбоя источника — Дима прочёл бы, что Шоколадница ушла.
  if (failed.length === 0) {
    const marked = await registry.markMissingPlaces('конкурент', points.map((p) => p.placeKey));
    console.log(`помечено кандидатами на закрытие: ${marked}`);
  } else {
    console.log('');
    console.log(`ВНИМАНИЕ: не собрались сети: ${failed.map((f) => f.chain).join(', ')}`);
    console.log('Пометка закрытий ПРОПУЩЕНА — обход неполный.');
  }

  console.log(`всего в реестре: ${await registry.countPlaces('конкурент')}`);
  console.log(`без первоисточника (не собраны, нужен вторичный): ${CHAINS_NO_SOURCE.join(', ')}`);
  return { failed, coverage };
}

async function stageEducation(registry) {
  console.log('=== ВУЗЫ И КОЛЛЕДЖИ ===');
  const universities = await fetchUniversities();
  const uniWritten = await registry.upsertPlaces(
    universities.map((u) => ({ ...u, kind: u.kind })),
    SRC_EDU
  );
  console.log(`записано: ${uniWritten}`);
  console.log(`  ВУЗы: ${await registry.countPlaces('вуз')}`);
  console.log(`  колледжи: ${await registry.countPlaces('колледж')}`);

  console.log('=== НИИ ===');
  const research = await fetchResearchInstitutes();
  const niiWritten = await registry.upsertPlaces(
    research.map((r) => ({ ...r, kind: 'нии' })),
    SRC_EDU
  );
  console.log(`записано: ${niiWritten}`);
  console.log(`всего в реестре: ${await registry.countPlaces('нии')}`);
}

const stage = process.argv[2] || 'all';
const registry = new Registry(loadConfig());

try {
  if (stage === 'competitors' || stage === 'all') await stageCompetitors(registry);
  if (stage === 'education' || stage === 'all') await stageEducation(registry);
  console.log('');
  console.log(OSM_ATTRIBUTION);
} finally {
  await registry.close();
}
