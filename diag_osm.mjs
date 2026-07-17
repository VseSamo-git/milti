/**
 * ДИАГНОСТИКА (временный файл, не часть сборки).
 *
 * Цель: понять, почему сеть даёт мало точек. Три среза на сеть:
 *   narrow — как ищет боевой код: только тег name, bbox «МКАД»
 *   broad  — по name|brand|operator|name:en|name:ru|... тот же bbox
 *   wide   — тот же broad, но bbox всей Москвы (ТиНАО + Зеленоград)
 *
 * Печатает и реальные написания имён из OSM — чтобы не гадать, а видеть.
 */
import { bboxString, parseElements, runOverpass } from './src/lib/overpass.js';
import { COMPETITOR_CHAINS } from './src/sources/competitors.js';

const BBOX_MKAD = { south: 55.55, west: 37.35, north: 55.92, east: 37.85 };
const BBOX_MSK_FULL = { south: 55.14, west: 36.80, north: 56.05, east: 37.97 };

// Широкий зонд: сеть может быть подписана брендом, а не именем.
const KEYS = '^(name|name:ru|name:en|brand|brand:ru|brand:en|operator|alt_name|official_name)$';

// Написания, которые боевой регэксп может не покрывать. Держим отдельно,
// чтобы сравнить «что ищем» с «что есть».
const PROBES = {
  'french bakery': 'French|Френч|Фрэнч',
  drinkit: 'Drinkit|Дринкит|Дринк',
  'братья караваевы': 'Караваев',
  prime: 'Prime|Прайм',
  муму: 'Му-Му|Муму|Му Му',
  здрасте: 'Здрасте|Здрасьте',
  шоколадница: 'Шоколадница|Shokoladnitsa|Chocoladnitsa',
  'bodro coffee': 'Bodro|Бодро',
  'parle market': 'Parle|Парле',
  'правда кофе': 'Правда|Pravda',
  'дни недели': 'Дни недели|Dni nedeli',
};

const narrowQ = (match, bbox) =>
  `[out:json][timeout:180];nwr["name"~"${match}",i](${bboxString(bbox)});out tags center 3000;`;

const broadQ = (match, bbox) =>
  `[out:json][timeout:180];nwr[~"${KEYS}"~"${match}",i](${bboxString(bbox)});out tags center 3000;`;

async function count(query) {
  const payload = await runOverpass(query, { attempts: 4, backoffMs: 15000 });
  return parseElements(payload);
}

const label = (els) => {
  const names = new Map();
  for (const el of els) {
    const n = el.name || `(без name, brand=${el.tags.brand || el.tags.operator || '?'})`;
    names.set(n, (names.get(n) || 0) + 1);
  }
  return [...names.entries()].sort((a, b) => b[1] - a[1]);
};

const only = process.argv[2];
const chains = only ? COMPETITOR_CHAINS.filter((c) => c.key === only) : COMPETITOR_CHAINS;

console.log('сеть | narrow(name,МКАД) | broad(все теги,МКАД) | wide(все теги,вся Москва)');
console.log('='.repeat(78));

const report = [];

for (const chain of chains) {
  const probe = PROBES[chain.key] || chain.match;
  const live = chain.match.replace(/\\/g, '');

  try {
    const narrow = await count(narrowQ(live, BBOX_MKAD));
    const broad = await count(broadQ(probe, BBOX_MKAD));
    const wide = await count(broadQ(probe, BBOX_MSK_FULL));

    console.log(`\n${chain.key}: ${narrow.length} | ${broad.length} | ${wide.length}`);
    console.log(`  боевой регэксп: /${chain.match}/i   зонд: /${probe}/i`);
    console.log('  что реально лежит в OSM (wide):');
    for (const [name, n] of label(wide).slice(0, 12)) console.log(`    ${n}x  ${name}`);

    report.push({ chain: chain.key, narrow: narrow.length, broad: broad.length, wide: wide.length });
  } catch (error) {
    console.log(`\n${chain.key}: ОШИБКА ${error.message}`);
    report.push({ chain: chain.key, error: error.message });
  }
}

console.log(`\n${'='.repeat(78)}\nИТОГ`);
console.table(report);
