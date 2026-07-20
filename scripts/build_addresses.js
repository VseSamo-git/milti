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
 * ВОЗОБНОВЛЯЕМЫЙ. Оплачено болью: прогон умер на 300 000 из 548 427 из-за
 * секундного ENOTFOUND — DNS моргнул дольше, чем длились повторы, — и
 * потерял полчаса работы, потому что начинал бы с нуля. Теперь пишем
 * промежуточный файл каждые 50 страниц и продолжаем с последнего offset.
 *
 * Запуск (долгий, ~550 страниц):
 *   node run.js ./scripts/build_addresses.js
 *   node run.js ./scripts/build_addresses.js --restart   # начать заново
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { withRetry } from '../src/lib/retry.js';
import { ATTRIBUTION, fetchCatalogId, fetchPage } from '../src/sources/addr_registry.js';

const DEST = 'data/buildings.json';
const PARTIAL = 'data/buildings.partial.json';
const PAGE = 1000;
const SAVE_EVERY = 50_000;

const { catalogId, totalObjects } = await withRetry(() => fetchCatalogId(), {
  attempts: 5,
  backoffMs: 3000,
});
console.log(`каталог ${catalogId}, объектов в реестре: ${totalObjects}`);

let buildings = [];
let offset = 0;
let skippedNoGeo = 0;
let skippedNoAddr = 0;

// Подхватываем недокачанное. Файл пишется целиком и атомарно (через
// временный + rename), поэтому оборванной записи в нём быть не может.
if (!process.argv.includes('--restart') && existsSync(PARTIAL)) {
  const saved = JSON.parse(await readFile(PARTIAL, 'utf8'));
  buildings = saved.buildings;
  offset = saved.offset;
  skippedNoGeo = saved.skippedNoGeo ?? 0;
  skippedNoAddr = saved.skippedNoAddr ?? 0;
  console.log(`продолжаю с ${offset}, уже собрано ${buildings.length}`);
}

async function saveProgress() {
  const tmp = `${PARTIAL}.tmp`;
  await writeFile(tmp, JSON.stringify({ offset, buildings, skippedNoGeo, skippedNoAddr }), 'utf8');
  await rename(tmp, PARTIAL);
}

let sinceSave = 0;

for (;;) {
  // Портал под нагрузкой отдаёт 504 — это шлюз, лечится повтором.
  // Без повторов выгрузка на 550 страниц не доживает до конца.
  // Повторов много и с длинной паузой: за полчаса выгрузки сеть успевает
  // моргнуть, и ENOTFOUND на секунду не должен стоить всего прогона.
  const rows = await withRetry(() => fetchPage(catalogId, offset, PAGE), {
    attempts: 10,
    backoffMs: 5000,
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
  sinceSave += rows.length;

  if (sinceSave >= SAVE_EVERY) {
    await saveProgress();
    sinceSave = 0;
    console.log(`  ${offset}/${totalObjects}, годных ${buildings.length} (сохранено)`);
  }

  if (rows.length < PAGE) break;
}

await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, JSON.stringify(buildings), 'utf8');

// Промежуточный файл больше не нужен: следующий запуск должен начать
// с чистого листа, а не «продолжить» уже завершённую выгрузку.
if (existsSync(PARTIAL)) await rm(PARTIAL);

console.log('');
console.log(`зданий с адресом и координатами: ${buildings.length}`);
console.log(`пропущено без координат: ${skippedNoGeo}, без адреса: ${skippedNoAddr}`);
console.log(`сохранено: ${DEST}`);
console.log(ATTRIBUTION);
