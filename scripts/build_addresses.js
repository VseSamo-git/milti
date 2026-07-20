/**
 * Справочник зданий Москвы: UNOM -> адрес + координаты.
 *
 * ЗАЧЕМ. У точек из OSM (ВУЗы, НИИ, колледжи) координаты есть почти всегда,
 * а тега адреса почти нет: 108 из 364 у ВУЗов, 140 из 472 у НИИ. Дима просит
 * адреса. Обратная дыра у store-locator'ов: French Bakery даёт адрес, но не
 * даёт координат. Этот справочник закрывает обе — по координате находим
 * здание и берём его адрес, по адресу можем найти координату.
 *
 * ПОЧЕМУ SIMPLE_ADDRESS, а не ADDRESS. Полный ADDRESS — это канцелярская
 * строка «Российская Федерация, город Москва, внутригородская территория
 * муниципальный округ Вешняки, Косинская улица, дом 26А». SIMPLE_ADDRESS —
 * «Косинская улица, дом 26А». Диме в таблицу нужен второй.
 *
 * ЛИЦЕНЗИЯ: data.mos.ru, датасет 60562, CC BY 4.0 — см. ATTRIBUTION.
 *
 * Запуск (долгий, ~550 страниц):
 *   node run.js ./scripts/build_addresses.js
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { withRetry } from '../src/lib/retry.js';
import { ATTRIBUTION, fetchCatalogId, fetchPage } from '../src/sources/addr_registry.js';

const DEST = 'data/buildings.json';
const PAGE = 1000;

const { catalogId, totalObjects } = await withRetry(() => fetchCatalogId(), {
  attempts: 5,
  backoffMs: 3000,
});
console.log(`каталог ${catalogId}, объектов в реестре: ${totalObjects}`);

const buildings = [];
let offset = 0;
let skippedNoGeo = 0;
let skippedNoAddr = 0;

for (;;) {
  // Портал под нагрузкой отдаёт 504 — это шлюз, лечится повтором.
  // Без повторов выгрузка на 550 страниц не доживает до конца.
  const rows = await withRetry(() => fetchPage(catalogId, offset, PAGE), {
    attempts: 6,
    backoffMs: 4000,
  });
  if (!rows.length) break;

  for (const raw of rows) {
    const row = raw?.Cells || raw;
    if (row?.is_deleted) continue;

    const unom = Number(row?.UNOM);
    if (!Number.isFinite(unom) || unom === 0) continue;

    // Порядок осей GeoJSON: [lon, lat]. Перепутать — отправить всю Москву
    // в Индийский океан (широта ~55, долгота ~37).
    const coords = row?.geodata_center?.coordinates;
    const [lon, lat] = Array.isArray(coords) ? coords : [null, null];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      skippedNoGeo += 1;
      continue;
    }

    const address = String(row?.SIMPLE_ADDRESS || '').trim();
    if (!address) {
      skippedNoAddr += 1;
      continue;
    }

    buildings.push({ unom, address, lat, lon });
  }

  offset += rows.length;
  if (offset % 50_000 === 0) console.log(`  ${offset}/${totalObjects}, годных ${buildings.length}`);
  if (rows.length < PAGE) break;
}

await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, JSON.stringify(buildings), 'utf8');

console.log('');
console.log(`зданий с адресом и координатами: ${buildings.length}`);
console.log(`пропущено без координат: ${skippedNoGeo}, без адреса: ${skippedNoAddr}`);
console.log(`сохранено: ${DEST}`);
console.log(ATTRIBUTION);
