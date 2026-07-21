/**
 * Точечный сбор ТОЛЬКО вторичных сетей (drinkit, здрасте, parle market) из OSM.
 *
 * Отдельно от полного build_places competitors: не трогает 8 первичных сетей
 * и их статусы закрытий. Вторичные точки пишутся с confidence=low и НЕ
 * участвуют в детекции «возможно закрылась» (краудсорс к этому непригоден).
 *
 * Запуск:
 *   node run.js ./scripts/collect_secondary.js
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { OSM_ATTRIBUTION } from '../src/lib/overpass.js';
import { fetchAllCompetitors } from '../src/sources/competitors.js';
import { SECONDARY_ADAPTERS } from '../src/sources/competitors/osm_secondary.js';

const registry = new Registry(loadConfig());

try {
  console.log('=== ВТОРИЧНЫЕ СЕТИ (OSM, неполно) ===');
  const { points, failed, coverage } = await fetchAllCompetitors({
    adapters: SECONDARY_ADAPTERS,
    onProgress: (e) => {
      if (e.error) console.log(`   ${e.chain}: УПАЛ — ${e.error.message.slice(0, 50)}`);
      else if (e.moscow === null) console.log(`   ${e.chain}: ПУСТО — ${e.verdict.reason}`);
      else console.log(`   ${e.chain}: Москва ${e.moscow}  (${e.verdict.reason})`);
    },
  });

  if (failed.length) {
    console.log(`\nне собрались (Overpass лёг?): ${failed.map((f) => f.chain).join(', ')}`);
  }

  const written = await registry.upsertPlaces(points.map((p) => ({ ...p, kind: 'конкурент' })));
  console.log(`\nзаписано точек: ${written}`);

  console.log('\nитог по вторичным:');
  for (const c of coverage) console.log(`   ${c.chain}: ${c.reason}`);

  // Что реально легло в базу по этим трём сетям.
  const rows = await registry.sql`
    SELECT chain, count(*)::int AS n, count(*) FILTER (WHERE lat IS NOT NULL)::int AS coord
    FROM kosmos.places
    WHERE kind = 'конкурент' AND source = 'osm_secondary'
    GROUP BY chain ORDER BY chain`;
  console.log('\nв реестре (source=osm_secondary):');
  for (const r of rows) console.log(`   ${r.chain}: ${r.n} (с координатами ${r.coord})`);

  console.log('');
  console.log(OSM_ATTRIBUTION);
} finally {
  await registry.close();
}
