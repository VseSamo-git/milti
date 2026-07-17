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
import { COMPETITOR_CHAINS, fetchAllCompetitors, SOURCE as SRC_COMP } from '../src/sources/competitors.js';
import { fetchResearchInstitutes, fetchUniversities, SOURCE as SRC_EDU } from '../src/sources/education.js';

async function stageCompetitors(registry) {
  console.log('=== КОНКУРЕНТЫ ===');
  const { points, failed } = await fetchAllCompetitors({
    onProgress: (chain, found, total, error) =>
      console.log(
        error ? `   ${chain}: НЕ ОТВЕТИЛ (${error.message.slice(0, 40)})` : `   ${chain}: ${found} (всего ${total})`
      ),
  });

  const written = await registry.upsertPlaces(
    points.map((p) => ({ ...p, kind: 'конкурент' })),
    SRC_COMP
  );
  console.log(`записано точек: ${written}`);

  // ВАЖНО. Помечать пропавшие точки можно ТОЛЬКО если обход был полным.
  // Иначе сеть, не ответившая из-за таймаута Overpass, будет целиком
  // помечена «закрылась» — и Дима в воскресенье прочтёт, что Шоколадница
  // ушла из Москвы. Молчаливая ложь хуже отсутствия данных.
  if (failed.length === 0) {
    const marked = await registry.markMissingPlaces('конкурент', points.map((p) => p.osmId));
    console.log(`помечено кандидатами на закрытие: ${marked}`);
  } else {
    console.log('');
    console.log(`ВНИМАНИЕ: не ответили сети: ${failed.map((f) => f.chain).join(', ')}`);
    console.log('Пометка закрытий ПРОПУЩЕНА — обход неполный, иначе целая сеть');
    console.log('была бы объявлена закрытой из-за сбоя источника.');
  }

  console.log(`всего в реестре: ${await registry.countPlaces('конкурент')}`);
  return failed;
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
