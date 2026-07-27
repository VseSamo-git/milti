/**
 * Справочник станций метро Москвы из OpenStreetMap (один раз, потом джойн по
 * координате в маршрутах). Логика разбора — src/lib/metro.js (под тестами),
 * запрос — общий клиент Overpass (зеркала + ретраи).
 *
 * Запуск: node scripts/fetch_metro.mjs
 * Результат: docs/metro.json
 */
import fs from 'node:fs';
import { runOverpass, bboxString, MOSCOW_BBOX, OSM_ATTRIBUTION } from '../src/lib/overpass.js';
import { parseStations } from '../src/lib/metro.js';

const bbox = bboxString(MOSCOW_BBOX);
const query = `[out:json][timeout:60];
(
  node["station"="subway"](${bbox});
  way["station"="subway"](${bbox});
  relation["station"="subway"](${bbox});
);
out center tags;`;

console.log('Запрашиваю станции метро у Overpass…');
const payload = await runOverpass(query);
const stations = parseStations(payload);
console.log(`Станций метро (именованных, без дублей): ${stations.length}`);
for (const s of stations.slice(0, 5)) console.log(`  • ${s.name} [${s.lat}, ${s.lon}]`);

fs.writeFileSync('docs/metro.json', JSON.stringify({ source: 'OpenStreetMap subway stations, Москва', attribution: OSM_ATTRIBUTION, count: stations.length, stations }, null, 1));
console.log('\nСохранил: docs/metro.json');
