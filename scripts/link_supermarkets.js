/**
 * ТЦ с продуктовым супермаркетом — шестой список Димы.
 *
 * ПОЧЕМУ ПЕРЕПИСАНО. Первая версия помечала ТЦ по названию и тегам OSM,
 * и в список попали «Тойота-лексус ВДНХ», «АвтоГермес», «Мебель Сити»,
 * «Корея-Авто». Виноват был признак building=retail: у автосалона и
 * мебельного он такой же, как у торгового центра. Дима это заметил
 * сразу — «как может быть продуктовый маркет в салоне Лексус?».
 *
 * ПРАВИЛЬНЫЙ ПРИЗНАК — тот, что в самом задании: «торговые центры,
 * в которых ЕСТЬ продуктовый супермаркет». Значит идём от супермаркетов:
 * находим Пятёрочки и Перекрёстки, смотрим, в каком здании они сидят,
 * и это здание и есть ТЦ. В салоне Лексус Пятёрочки нет — он отсеется
 * сам, без списков запрещённых слов.
 *
 * Запуск:
 *   node run.js ./scripts/link_supermarkets.js
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { OSM_ATTRIBUTION } from '../src/lib/overpass.js';
import { distanceMeters } from '../src/sources/building_names.js';
import { fetchMoscowSupermarkets } from '../src/sources/supermarkets.js';

const SOURCE = 'osm_supermarkets';
const MAX_M = 80;

const registry = new Registry(loadConfig());

try {
  console.log('тяну супермаркеты из OSM...');
  const shops = await fetchMoscowSupermarkets({
    onProgress: (brand, n, total) => console.log(`   ${brand}: ${n} (всего ${total})`),
  });
  console.log(`супермаркетов: ${shops.length}`);

  const buildings = await registry.sql`
    SELECT id, lat, lon, area_sqm FROM kosmos.objects
    WHERE lat IS NOT NULL AND annex = 1`;
  console.log(`зданий с координатами: ${buildings.length}`);

  // Здание -> какие супермаркеты в нём сидят.
  const inBuilding = new Map();
  for (const s of shops) {
    let best = null;
    for (const b of buildings) {
      const d = distanceMeters(Number(b.lat), Number(b.lon), s.lat, s.lon);
      if (d > MAX_M) continue;
      if (!best || d < best.d) best = { d, id: b.id };
    }
    if (!best) continue;
    if (!inBuilding.has(best.id)) inBuilding.set(best.id, new Set());
    inBuilding.get(best.id).add(s.brand || s.name);
  }
  console.log(`зданий с супермаркетом внутри: ${inBuilding.size}`);

  // Сначала снимаем прежнюю пометку 'тц' — она ставилась по названию
  // и затащила автосалоны. Ставим заново только там, где есть продукты.
  await registry.sql`
    UPDATE kosmos.objects SET object_type = 'неизвестен'
    WHERE object_type = 'тц'`;

  const rows = [...inBuilding].map(([id, brands]) => [id, [...brands].sort().join(', ')]);
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await registry.sql`
      UPDATE kosmos.objects o
      SET object_type = 'тц', supermarkets = v.brands
      FROM (VALUES ${registry.sql(rows.slice(i, i + CHUNK))}) AS v(id, brands)
      WHERE o.id = v.id::bigint
    `;
  }

  const [stat] = await registry.sql`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE area_sqm >= 5000)::int AS big
    FROM kosmos.objects WHERE object_type = 'тц'`;
  console.log(`\nТЦ с супермаркетом: ${stat.n}, из них от 5000 м²: ${stat.big}`);

  const top = await registry.sql`
    SELECT title, address, round(area_sqm)::int AS area, supermarkets
    FROM kosmos.objects WHERE object_type = 'тц' AND area_sqm IS NOT NULL
    ORDER BY area_sqm DESC LIMIT 8`;
  console.log('\nкрупнейшие:');
  for (const t of top) {
    console.log(`  ${t.area} м² — ${t.title || t.address?.slice(0, 45)} [${t.supermarkets}]`);
  }

  console.log('');
  console.log(OSM_ATTRIBUTION);
} finally {
  await registry.close();
}
