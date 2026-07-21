/**
 * Вторичный источник для трёх сетей БЕЗ доступного первоисточника:
 * drinkit и «Здрасте» прячут API за анти-ботом, у Parle Market своего
 * локатора нет вовсе (см. HANDOFF и заметку в ./index.js). Обход защиты
 * не встраиваем — берём то, что есть в OpenStreetMap.
 *
 * ЧЕСТНО ПРО НЕПОЛНОТУ. OSM — краудсорс: покрытие этих сетей 10–40% от
 * реального размера (разведка 2026-07-21: drinkit 47 из ~116, здрасте 21
 * из ~111, parle 3 из ~24+). Поэтому:
 *   - kind: 'secondary' — канарейка НЕ душит их как «сломанный парсер»,
 *     но и не выдаёт за полный обход: покрытие печатается как «неполно»;
 *   - confidence: 'low' — в витрине видно, что источник вторичный;
 *   - в детекцию «возможно закрылась» эти сети НЕ входят: в краудсорсе
 *     отсутствие точки — это чужая недонесённая правка, а не закрытие.
 *
 * expectedMin — размер сети по разведке (Yandex/Zoon). Служит знаменателем
 * в отчёте о покрытии, а не порогом отсева.
 *
 * ЛИЦЕНЗИЯ: OpenStreetMap, ODbL, атрибуция при использовании.
 */
import { runOverpass, parseElements, bboxString } from '../../lib/overpass.js';

// Названия у этих сетей достаточно характерны, чтобы ловить по name/brand
// без ложных срабатываний: «Дринкит», «Здрасте», «Parle Market» — не общие
// слова. Разведка подтвердила: посторонних объектов запрос не тянет.
const CHAINS = [
  { chain: 'drinkit', re: 'Дринкит|Drinkit', expectedMin: 116 },
  { chain: 'здрасте', re: 'Здрасте|Zdraste', expectedMin: 111 },
  { chain: 'parle market', re: 'Parle Market|Парле Маркет|Parle', expectedMin: 24 },
];

function buildQuery(re) {
  const box = bboxString();
  // И name, и brand: сеть в OSM тегают то так, то так.
  return (
    '[out:json][timeout:120];' +
    `(nwr["name"~"${re}",i](${box});nwr["brand"~"${re}",i](${box}););` +
    'out tags center 400;'
  );
}

function makeAdapter({ chain, re, expectedMin }) {
  return {
    chain,
    source: 'osm_secondary',
    confidence: 'low',
    kind: 'secondary',
    expectedMin,

    async fetch() {
      const payload = await runOverpass(buildQuery(re));
      const seen = new Set();
      const raw = [];
      for (const el of parseElements(payload)) {
        if (seen.has(el.osmId)) continue;
        seen.add(el.osmId);
        const address = [el.street, el.house].filter(Boolean).join(' ') || null;
        raw.push({
          id: el.osmId, // стабилен между заходами — держит place_key постоянным
          name: el.name || null,
          address,
          lat: el.lat,
          lon: el.lon,
        });
      }
      // stated нет: OSM не знает размер сети. Сверка идёт с expectedMin.
      return { stated: null, raw };
    },
  };
}

export const SECONDARY_ADAPTERS = CHAINS.map(makeAdapter);

// Ключ источника — чтобы детекция закрытий обходила эти сети стороной.
export const SECONDARY_SOURCE = 'osm_secondary';
