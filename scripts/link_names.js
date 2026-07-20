/**
 * Привязать названия зданий из OSM к объектам перечня.
 *
 * КАК. У наших объектов координаты из адресного реестра Москвы — это
 * центроид здания. У OSM тоже центроид. Совпадают они с точностью
 * десятков метров, поэтому берём ближайшее именованное здание в радиусе
 * MAX_M и записываем его название.
 *
 * ПРО ТОЧНОСТЬ — ГЛАВНОЕ. Расстояние до найденного названия пишется
 * в title_distance_m. Это не украшение: без него «привязали 500 зданий»
 * — заявление на веру, а с ним видно, сколько из них легли в 10 метров,
 * а сколько в 90, и где начинается мусор. Радиус 60 м выбран как средний
 * размер крупного здания: дальше начинаются соседние дома.
 *
 * КЛАССИФИКАЦИЯ. Название нашлось и профиль деловой -> object_type='бц'.
 * Торговый -> 'тц' (шестой список Димы). Не нашлось, но объект в перечне
 * 700-ПП -> остаётся офисным зданием: это ровно случай «картами как БЦ
 * не опознан, но функционирует как БЦ».
 *
 * Запуск:
 *   node run.js ./scripts/link_names.js
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { OSM_ATTRIBUTION } from '../src/lib/overpass.js';
import { classify, distanceMeters, fetchNamedBuildings, SOURCE } from '../src/sources/building_names.js';

const MAX_M = 60;

const registry = new Registry(loadConfig());

try {
  // Колонка расстояния — доказательство качества привязки, а не деталь.
  await registry.sql.unsafe(`
    ALTER TABLE kosmos.objects ADD COLUMN IF NOT EXISTS title_distance_m numeric;
  `);

  console.log('тяну именованные здания из OSM...');
  const named = await fetchNamedBuildings();
  console.log(`получено: ${named.length}`);

  const targets = await registry.sql`
    SELECT id, lat, lon FROM kosmos.objects
    WHERE lat IS NOT NULL AND annex = 1`;
  console.log(`наших зданий с координатами: ${targets.length}`);

  // Для каждого объекта ищем ближайшее название. Идём от объектов,
  // а не от OSM: так у каждого здания ровно одно название, а не гонка
  // нескольких OSM-точек за один дом.
  const best = new Map();

  for (const el of named) {
    const kind = classify(el);
    if (kind === 'иное') continue;

    for (const t of targets) {
      const d = distanceMeters(Number(t.lat), Number(t.lon), el.lat, el.lon);
      if (d > MAX_M) continue;
      const prev = best.get(t.id);
      if (!prev || d < prev.d) best.set(t.id, { d, name: el.name, kind });
    }
  }

  console.log(`совпало объектов: ${best.size}`);

  const CHUNK = 500;
  const rows = [...best].map(([id, v]) => ({ id, ...v }));
  let written = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    await registry.sql`
      UPDATE kosmos.objects o SET
        title            = v.name,
        title_source     = ${SOURCE},
        title_distance_m = v.d::numeric,
        object_type      = v.kind
      FROM (VALUES ${registry.sql(slice.map((r) => [r.id, r.name, String(r.d), r.kind]))})
           AS v(id, name, d, kind)
      WHERE o.id = v.id::bigint
    `;
    written += slice.length;
  }

  console.log(`записано названий: ${written}`);

  // Отчёт о качестве: без него точность — вопрос веры.
  const q = await registry.sql`
    SELECT
      count(*) FILTER (WHERE title_distance_m <= 15)::int AS "до 15 м",
      count(*) FILTER (WHERE title_distance_m > 15 AND title_distance_m <= 30)::int AS "15-30 м",
      count(*) FILTER (WHERE title_distance_m > 30)::int AS "больше 30 м",
      count(*) FILTER (WHERE object_type = 'бц')::int AS "БЦ",
      count(*) FILTER (WHERE object_type = 'тц')::int AS "ТЦ"
    FROM kosmos.objects WHERE title IS NOT NULL`;
  console.log('');
  console.log('точность привязки:', JSON.stringify(q[0], null, 2));

  const big = await registry.sql`
    SELECT title, round(area_sqm)::int AS area, round(title_distance_m)::int AS d
    FROM kosmos.objects
    WHERE title IS NOT NULL AND area_sqm >= 10000
    ORDER BY area_sqm DESC LIMIT 10`;
  console.log('');
  console.log('крупнейшие с названиями:');
  for (const b of big) console.log(`  ${b.area} м² — «${b.title}» (${b.d} м)`);

  console.log('');
  console.log(OSM_ATTRIBUTION);
} finally {
  await registry.close();
}
