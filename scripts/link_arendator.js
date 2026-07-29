/**
 * Привязка зданий реестра к БЦ каталога arendator.ru по координатам.
 *
 * ЗАЧЕМ. arendator.ru — курированный каталог БЦ ≥10к Москвы (782 шт.).
 * Совпадение здания реестра с точкой Арендатора ≤ порога — надёжное
 * подтверждение «это БЦ», сильнее и OSM-имени, и геометрии. Метка кладётся
 * в ОТДЕЛЬНЫЕ колонки (arendator_*), а не в object_type: так пересборка
 * OSM/супермаркетов её не затрёт, и провенанс явный (url Арендатора).
 *
 * Порог 80 м: координаты Арендатора геокодятся из адреса (не центроид
 * здания), поэтому берём шире, чем 60 м у OSM. Каталог курирован — даже
 * дальняя пара почти всегда попадает в настоящий БЦ.
 *
 * Идемпотентно: перезаписывает arendator_* по текущему ближайшему.
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';

const THRESHOLD_M = 80;

const R = 6371000, rad = (d) => (d * Math.PI) / 180;
function distM(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export async function linkArendator(registry, thresholdM = THRESHOLD_M) {
  const cat = JSON.parse(readFileSync('docs/arendator_bc.json', 'utf8'));
  const bc = cat.items.filter((x) => x.lat && x.lon);
  const objs = await registry.sql`
    SELECT cadastral_no, lat, lon FROM kosmos.objects
    WHERE annex = 1 AND lat IS NOT NULL AND lon IS NOT NULL`;

  // Для каждого БЦ Арендатора — ближайшее здание реестра. Одному зданию
  // может соответствовать несколько записей Арендатора (башни комплекса) —
  // берём минимальную дистанцию.
  const best = new Map(); // cadastral_no -> {dist, url, name}
  let matchedArend = 0;
  for (const b of bc) {
    let bd = Infinity, bo = null;
    for (const o of objs) {
      const d = distM(b.lat, b.lon, o.lat, o.lon);
      if (d < bd) { bd = d; bo = o; }
    }
    if (bo && bd <= thresholdM) {
      matchedArend++;
      const prev = best.get(bo.cadastral_no);
      if (!prev || bd < prev.dist) best.set(bo.cadastral_no, { dist: bd, url: b.url, name: b.name });
    }
  }

  const rows = [...best.entries()].map(([cad, m]) => [cad, String(Math.round(m.dist)), m.url]);
  if (rows.length) {
    await registry.sql`
      UPDATE kosmos.objects o SET
        arendator_matched = true,
        arendator_dist_m  = v.dist::numeric,
        arendator_url     = v.url
      FROM (VALUES ${registry.sql(rows)}) AS v(cad, dist, url)
      WHERE o.cadastral_no = v.cad`;
  }

  const [stat] = await registry.sql`
    SELECT
      count(*) AS всего_совпало,
      count(*) FILTER (WHERE object_type = 'неизвестен') AS подтвердили_новых,
      count(*) FILTER (WHERE object_type = 'бц') AS совпало_с_OSM,
      count(*) FILTER (WHERE object_type = 'тц') AS mixed_use_тц,
      count(*) FILTER (WHERE area_sqm >= 10000) AS "≥10k"
    FROM kosmos.objects WHERE arendator_matched = true`;

  console.log(`Арендатор: ${bc.length} БЦ с координатами, спарено ≤${thresholdM}м: ${matchedArend}`);
  console.log(`уникальных зданий реестра с меткой: ${rows.length}`);
  console.log('раскладка:', JSON.stringify(stat, null, 2));
  return { matched: rows.length };
}

if (isMain(import.meta.url)) {
  const registry = new Registry(loadConfig());
  try {
    await linkArendator(registry);
  } finally {
    await registry.close();
  }
}
