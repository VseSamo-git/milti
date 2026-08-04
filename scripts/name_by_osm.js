/**
 * Поисковик названий для безымянных зданий по OSM Overpass (bbox-батч).
 *
 * ИДЕЯ. У безымянного здания есть координата. Открытая геобаза OSM часто знает,
 * какая организация тут сидит (Росатом, Технопромэкспорт, НИИ, вуз). Берём это
 * имя. Это то же «узнать, что за здание», но по источнику, который разрешает
 * автозапросы (скрапинг Яндекса — капча/бан, поэтому не он).
 *
 * ПОЧЕМУ BBOX. Публичный Overpass режет частые построчные запросы (429). Поэтому
 * не спрашиваем по одному зданию, а тайлим Москву сеткой и одним запросом на
 * ячейку тянем ВСЕ именованные деловые объекты в ней, потом матчим локально.
 * ~330 зданий → десятки запросов вместо сотен. Сырые ответы кэшируем.
 *
 * ФИЛЬТР. Берём только деловое: офис/компания/госорган/НИИ/вуз/клиника-здание.
 * Еду, розницу, аптеки, стоматологии (арендаторы 1-го этажа, не имя здания) —
 * отсекаем ещё в запросе. Ближайшее подходящее в радиусе MATCH м — кандидат.
 *
 * Запуск:  node run.js ./scripts/name_by_osm.js [--limit N] [--central] [--apply]
 *   без --apply — только показать, что нашлось (в базу не пишем).
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CACHE_FILE = './osm_bbox_cache.json';
const MATCH = 35;          // радиус матча здание↔именованный объект, м
const CELL = 0.10;         // размер ячейки сетки (~9 км) — крупно, чтобы запросов
                           // было мало (публичный Overpass троттлит частые)
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

let cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {};
const saveCache = () => writeFileSync(CACHE_FILE, JSON.stringify(cache));

const R = 6371000, rad = (d) => d * Math.PI / 180;
const distM = (a, b, c, d) => {
  const x = rad(c - a), y = rad(d - b);
  const s = Math.sin(x / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
const BAD_NAME = (n) => /жилой|жк[ "»]|подъезд|квартир|гараж|парковк|детск|магазин|аптек|салон красоты/i.test(n || '');

/** Один запрос Overpass по bbox: только деловые именованные объекты. */
async function overpassBbox(s, w, n, e) {
  const bbox = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:90];(`
    + `way["name"]["building"~"office|commercial|government|industrial|public",i](${bbox});`
    + `way["name"]["office"](${bbox});node["name"]["office"](${bbox});`
    + `way["name"]["amenity"~"university|college|research_institute|hospital|courthouse|townhall|community_centre",i](${bbox});`
    + `node["name"]["amenity"~"university|college|research_institute|hospital",i](${bbox});`
    + `);out center tags;`;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'User-Agent': 'kosmos-namer/1.0 (milti)' }, signal: AbortSignal.timeout(90000) });
        if (res.status === 429 || res.status === 504) { await sleep(1500); continue; }
        if (!res.ok) continue;
        return (await res.json()).elements || [];
      } catch { /* следующий эндпоинт */ }
    }
  }
  throw new Error('overpass недоступен');
}

/** Именованные объекты в ячейке (из кэша или из сети). */
async function cellFeatures(gy, gx) {
  const key = `${gy},${gx}`;
  if (cache[key]) return cache[key];
  const s = gy * CELL, w = gx * CELL, n = s + CELL, e = w + CELL;
  const els = await overpassBbox(s, w, n, e);
  const feats = els.map((el) => ({
    name: el.tags?.name, kind: el.tags?.office || el.tags?.building || el.tags?.amenity || '',
    lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon,
    isBuilding: el.type === 'way' && !!el.tags?.building,
  })).filter((f) => f.name && f.lat != null && !BAD_NAME(f.name));
  cache[key] = feats; saveCache();
  return feats;
}

/** Ближайший подходящий объект в радиусе MATCH. Здание-полигон приоритетнее POI. */
export function matchName(feats, lat, lon) {
  const near = feats
    .map((f) => ({ ...f, d: distM(lat, lon, f.lat, f.lon) }))
    .filter((f) => f.d <= MATCH)
    .sort((a, b) => (b.isBuilding ? 1 : 0) - (a.isBuilding ? 1 : 0) || a.d - b.d);
  return near[0] || null;
}

export async function nameByOsm(registry, { limit = 0, apply = false, central = false } = {}) {
  // Только безымянные, которые реально показываются Диме в листах «База» /
  // «На проверку» (а не все 17k зданий реестра без title).
  const rows = await registry.sql`
    SELECT o.cadastral_no, o.address, o.lat, o.lon
      FROM kosmos.objects o
     WHERE (o.title IS NULL OR btrim(o.title) = '' OR o.title ILIKE '%без названия%')
       AND o.lat IS NOT NULL AND o.status = 'активен'
       AND (${central} = false OR o.cadastral_no LIKE '77:01%')
       AND o.cadastral_no IN (
         SELECT "Ключ" FROM vitrina."База"
         UNION SELECT "Ключ" FROM vitrina."На проверку"
       )
     ORDER BY o.area_sqm DESC NULLS LAST
     ${limit ? registry.sql`LIMIT ${limit}` : registry.sql``}`;

  // сгруппировать здания по ячейкам сетки
  const cells = new Map();
  for (const o of rows) {
    const gy = Math.floor(o.lat / CELL), gx = Math.floor(o.lon / CELL);
    const key = `${gy},${gx}`;
    if (!cells.has(key)) cells.set(key, { gy, gx, items: [] });
    cells.get(key).items.push(o);
  }
  console.log(`безымянных: ${rows.length} | ячеек сетки: ${cells.size} | радиус матча ${MATCH} м\n`);

  const found = [];
  let ci = 0, failCells = 0;
  for (const { gy, gx, items } of cells.values()) {
    ci++;
    let feats = null;
    try { feats = await cellFeatures(gy, gx); }
    catch { failCells++; console.log(`  ✗ ячейка ${gy},${gx} — Overpass недоступен (${items.length} зданий пропущено)`); }
    if (feats) {
      for (const o of items) {
        const hit = matchName(feats, o.lat, o.lon);
        if (hit) { found.push({ key: o.cadastral_no, name: hit.name, d: Math.round(hit.d), kind: hit.kind }); }
      }
    }
    if (ci % 5 === 0) console.log(`   …ячеек ${ci}/${cells.size}, найдено ${found.length}`);
    if (!cache[`${gy},${gx}`]) await sleep(2500);
  }

  found.sort((a, b) => a.d - b.d);
  console.log(`\n=== НАЙДЕНО ИМЁН: ${found.length} из ${rows.length} ===`);
  for (const f of found.slice(0, 60)) console.log(`  ${String(f.d).padStart(3)} м · ${f.kind.padEnd(12)} · ${f.name}  [${f.key}]`);
  if (found.length > 60) console.log(`  … ещё ${found.length - 60}`);
  if (failCells) console.log(`\n⚠ ячеек с ошибкой Overpass: ${failCells} — их можно добрать повторным прогоном (кэш сохранит успешные)`);

  if (!apply) { console.log('\n(проба: --apply чтобы вписать названия в базу)'); return { checked: rows.length, found: found.length, failCells }; }

  // применяем только уверенные: ≤20 м. Дальние (20–35 м) — на ручную, не пишем.
  const sure = found.filter((f) => f.d <= 20);
  for (const f of sure) {
    await registry.sql`UPDATE kosmos.objects SET title=${f.name}, title_source='osm-namer'
      WHERE cadastral_no=${f.key} AND (title IS NULL OR btrim(title)='' OR title ILIKE '%без названия%')`;
  }
  console.log(`\nвписано (≤20 м, уверенно): ${sure.length}; отложено на ручную (20–35 м): ${found.length - sure.length}`);
  return { checked: rows.length, found: found.length, applied: sure.length };
}

if (isMain(import.meta.url)) {
  const li = process.argv.indexOf('--limit');
  const limit = li >= 0 ? Number(process.argv[li + 1] || 0) : 0;
  const registry = new Registry(loadConfig());
  try { await nameByOsm(registry, { limit, apply: process.argv.includes('--apply'), central: process.argv.includes('--central') }); }
  finally { await registry.close(); }
}
