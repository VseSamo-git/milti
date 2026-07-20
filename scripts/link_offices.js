/**
 * Офисы компаний — третий список Димы.
 *
 * ЧТО ПРОСИЛ ДИМА: название компании, адрес, площадь офиса, количество
 * сотрудников. Отдаём первые три, четвёртое честно нет.
 *
 * ОТКУДА. В OSM 7188 точек с тегом office и названием. Из них годятся
 * не все: 1330 — государственные конторы (ЗАГСы, управы, префектуры),
 * а Дима просил «офисы больших компаний». Их отсекаем: у управы района
 * нет тысячи офисных сотрудников с коротким обедом.
 *
 * АДРЕС И ПЛОЩАДЬ берём у здания, к которому точка привязалась по
 * координатам: у самой точки адрес есть лишь у 1608 из 7188.
 *
 * ЧЕГО НЕ БУДЕТ. Количество сотрудников и площадь именно офиса (а не
 * здания) не даёт ни один открытый источник. ЕГРЮЛ содержит юридический
 * адрес, который сплошь и рядом не совпадает с фактическим. Эти две
 * колонки закроет только 2ГИС. Вместо выдумки показываем «организаций
 * в здании» — сколько компаний село в тот же дом. Это не сотрудники,
 * но честный сигнал офисной плотности: пять юрлиц в здании на 30 000 м²
 * и одно — разные истории.
 *
 * Запуск:
 *   node run.js ./scripts/link_offices.js
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { bboxString, MOSCOW_BBOX, OSM_ATTRIBUTION, parseElements, runOverpass } from '../src/lib/overpass.js';
import { distanceMeters } from '../src/sources/building_names.js';

const SOURCE = 'osm_offices';
const MAX_M = 60;

// Коммерческие профили: то, что Дима называет «большими компаниями».
// government и diplomatic исключены намеренно — см. шапку.
const COMMERCIAL = new Set([
  'company', 'it', 'telecommunication', 'insurance', 'finance', 'financial',
  'accountant', 'lawyer', 'estate_agent', 'property_management', 'advertising_agency',
  'consulting', 'engineer', 'architect', 'logistics', 'employment_agency',
  'energy_supplier', 'travel_agent', 'research', 'newspaper', 'publisher',
]);

const registry = new Registry(loadConfig());

try {
  console.log('тяну офисы компаний из OSM...');
  const query =
    '[out:json][timeout:180];' +
    `nwr["office"]["name"](${bboxString(MOSCOW_BBOX)});` +
    'out tags center 8000;';
  const all = parseElements(await runOverpass(query, { attempts: 3, backoffMs: 15000 }));
  const offices = all.filter((e) => COMMERCIAL.has(e.tags.office));
  console.log(`всего точек: ${all.length}, коммерческих: ${offices.length}`);

  const buildings = await registry.sql`
    SELECT id, lat, lon FROM kosmos.objects
    WHERE lat IS NOT NULL AND annex = 1`;
  console.log(`зданий с координатами: ${buildings.length}`);

  // Привязка «офис -> здание». Одному зданию может достаться много
  // компаний — это и есть офисная плотность, её считаем ниже.
  const linked = [];
  for (const o of offices) {
    let best = null;
    for (const b of buildings) {
      const d = distanceMeters(Number(b.lat), Number(b.lon), o.lat, o.lon);
      if (d > MAX_M) continue;
      if (!best || d < best.d) best = { d, id: b.id };
    }
    if (best) linked.push({ objectId: best.id, name: o.name, kind: o.tags.office, d: best.d });
  }
  console.log(`привязалось к зданиям: ${linked.length}`);

  // Компаний на здание — тот самый сигнал плотности вместо сотрудников.
  const perBuilding = new Map();
  for (const l of linked) perBuilding.set(l.objectId, (perBuilding.get(l.objectId) || 0) + 1);
  console.log(`зданий с офисами: ${perBuilding.size}`);

  await registry.sql.unsafe(`
    CREATE TABLE IF NOT EXISTS kosmos.offices (
      id          bigserial PRIMARY KEY,
      object_id   bigint REFERENCES kosmos.objects(id),
      name        text NOT NULL,
      office_kind text,
      distance_m  numeric,
      source      text NOT NULL,
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (object_id, name)
    );
  `);
  await registry.sql`DELETE FROM kosmos.offices WHERE source = ${SOURCE}`;

  const CHUNK = 500;
  for (let i = 0; i < linked.length; i += CHUNK) {
    const slice = linked.slice(i, i + CHUNK).map((l) => ({
      object_id: l.objectId, name: l.name, office_kind: l.kind,
      distance_m: l.d, source: SOURCE,
    }));
    await registry.sql`
      INSERT INTO kosmos.offices ${registry.sql(slice, 'object_id', 'name', 'office_kind', 'distance_m', 'source')}
      ON CONFLICT (object_id, name) DO NOTHING
    `;
  }

  // org_count в objects — чтобы витрина не считала это на лету.
  await registry.sql.unsafe(`
    UPDATE kosmos.objects o
    SET org_count = c.n, org_count_source = '${SOURCE}'
    FROM (SELECT object_id, count(*)::int AS n FROM kosmos.offices GROUP BY object_id) c
    WHERE o.id = c.object_id
  `);

  const [stat] = await registry.sql`
    SELECT count(*)::int AS n,
           count(*) FILTER (WHERE o.area_sqm >= 10000)::int AS big
    FROM kosmos.offices f JOIN kosmos.objects o ON o.id = f.object_id`;
  console.log(`\nзаписано офисов: ${stat.n}, из них в зданиях от 10 000 м²: ${stat.big}`);

  const top = await registry.sql`
    SELECT f.name, round(o.area_sqm)::int AS area, o.org_count
    FROM kosmos.offices f JOIN kosmos.objects o ON o.id = f.object_id
    WHERE o.area_sqm IS NOT NULL ORDER BY o.area_sqm DESC LIMIT 8`;
  console.log('\nв крупнейших зданиях:');
  for (const t of top) console.log(`  ${t.area} м² — «${t.name}» (организаций в здании: ${t.org_count})`);

  console.log('');
  console.log(OSM_ATTRIBUTION);
} finally {
  await registry.close();
}
