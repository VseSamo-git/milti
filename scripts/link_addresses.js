/**
 * Подставить точкам адрес ближайшего здания из адресного реестра Москвы.
 *
 * ЗАКРЫВАЕТ ДЫРУ: у точек из OSM координаты есть почти всегда, а тег адреса
 * заполняют редко — 108 из 364 у ВУЗов, 140 из 472 у НИИ. Дима просит адреса.
 *
 * ЧТО ЭТО ЗА АДРЕС. Он ВЫВЕДЕН, а не сообщён: мы нашли ближайшее здание и
 * взяли его адрес. Поэтому пишем address_source='addr_registry' и расстояние
 * в метрах — Дима должен отличать «сеть says: я здесь» от «мы решили, что
 * это вон то здание». Дальше порога не подставляем ничего: чужой адрес
 * хуже пустого.
 *
 * НЕ ТРОГАЕТ уже заполненные адреса: у конкурентов адрес пришёл с сайта
 * сети, он достовернее нашей геометрической догадки.
 *
 * Требует: node run.js ./scripts/build_addresses.js (справочник зданий).
 *
 * Запуск:
 *   node run.js ./scripts/link_addresses.js
 *   node run.js ./scripts/link_addresses.js --max=150   # другой порог, м
 */
import { readFile } from 'node:fs/promises';

import { loadConfig } from '../src/config.js';
import { buildIndex, findNearest } from '../src/lib/nearest.js';
import { Registry } from '../src/lib/registry.js';
import { ATTRIBUTION } from '../src/sources/addr_registry.js';

const BUILDINGS = 'data/buildings.json';
const SOURCE = 'addr_registry';

// Порог по умолчанию — 100 м. Центр здания и точка внутри него дальше
// этого расходятся редко; на большем расстоянии начинается соседний дом.
const maxArg = process.argv.find((a) => a.startsWith('--max='));
const MAX_METERS = maxArg ? Number(maxArg.split('=')[1]) : 100;

const registry = new Registry(loadConfig());

try {
  const buildings = JSON.parse(await readFile(BUILDINGS, 'utf8'));
  console.log(`справочник зданий: ${buildings.length}`);
  const grid = buildIndex(buildings);

  // Только точки с координатами и БЕЗ адреса: заполненный адрес достовернее.
  const places = await registry.sql`
    SELECT id, kind, name, lat, lon FROM kosmos.places
    WHERE address IS NULL AND lat IS NOT NULL AND lon IS NOT NULL`;
  console.log(`точек без адреса, но с координатами: ${places.length}`);
  console.log(`порог: ${MAX_METERS} м`);

  const matched = [];
  let tooFar = 0;

  for (const place of places) {
    const hit = findNearest(grid, Number(place.lat), Number(place.lon), MAX_METERS);
    if (hit === null) {
      tooFar += 1;
      continue;
    }
    matched.push({
      id: place.id,
      address: hit.item.address,
      distance: Math.round(hit.distance * 10) / 10,
    });
  }

  console.log(`нашлось зданий в пределах порога: ${matched.length}, дальше порога: ${tooFar}`);

  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < matched.length; i += CHUNK) {
    const chunk = matched.slice(i, i + CHUNK);
    const result = await registry.sql`
      UPDATE kosmos.places p
      SET address            = v.address,
          address_source     = ${SOURCE},
          address_distance_m = v.distance::numeric
      FROM (VALUES ${registry.sql(
        chunk.map((m) => [m.id, m.address, String(m.distance)])
      )}) AS v(id, address, distance)
      WHERE p.id = v.id::bigint AND p.address IS NULL
    `;
    written += result.count;
  }
  console.log(`записано адресов: ${written}`);

  // Итог по видам — чтобы видеть, что реально закрылось.
  const after = await registry.sql`
    SELECT kind, count(*)::int AS total,
           count(*) FILTER (WHERE address IS NOT NULL)::int AS with_addr
    FROM kosmos.places GROUP BY kind ORDER BY total DESC`;
  console.log('');
  console.log('вид | всего | с адресом');
  for (const r of after) console.log(`${r.kind}: ${r.total} | ${r.with_addr}`);

  console.log('');
  console.log(ATTRIBUTION);
} finally {
  await registry.close();
}
