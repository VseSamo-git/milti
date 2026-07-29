/**
 * Ингест внешних БЦ, которых нет в перечне 700-ПП.
 *
 * ИСТОЧНИКИ (курированные каталоги, у объектов нет кадастра):
 *   • docs/arendator_bc.json — arendator.ru, БЦ ≥10к Москвы (координаты, имя, url)
 *   • docs/max_bc.json       — «база от макса», БЦ с координатами и площадью
 *   • docs/reconcile_excel_bc.json — новостройки 2025-2026 (имя, адрес, площадь; без координат)
 *
 * ЛОГИКА:
 *   1. Собираем кандидатов из всех источников в единый вид.
 *   2. Отсев совпавших с базой: если ≤80 м от любого объекта kosmos.objects —
 *      этот БЦ уже есть (реестровый или ранее влитый ext), пропускаем.
 *   3. Дедуп между источниками: одна и та же башня в Арендаторе и у Макса —
 *      берём первую (приоритет max > arendator > excel: у Макса есть площадь).
 *   4. Вставка выживших как ext-объектов:
 *      cadastral_no = 'ext:<код>:<lat,lon>', object_type='бц', origin=<источник>,
 *      annex=NULL (не из 700-ПП), провенанс площади/названия проставлен.
 *
 * Внешние объекты идут в «На проверку» (Дима ОК/Хуй), т.к. каталоги содержат
 * и не-офисы (оптовые рынки, склады) — object_type='бц' здесь заявка, не факт.
 *
 * Идемпотентно: ключ детерминирован по координатам, ON CONFLICT DO NOTHING.
 * Только чтение существующих + вставка новых; ничего не затирает.
 *
 * Запуск (на сервере, в сети web): node run.js ./scripts/ingest_external_bc.js
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { Registry, SOURCE_PP700 } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';

const MATCH_BASE_M = 80;   // ≤80 м до объекта базы → уже есть, не добавляем
const DEDUP_M = 80;        // ≤80 м между кандидатами → та же башня

const R = 6371000, rad = (d) => (d * Math.PI) / 180;
function distM(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Единый вид кандидата из всех источников. */
function loadCandidates() {
  const out = [];
  if (existsSync('docs/max_bc.json')) {
    const d = JSON.parse(readFileSync('docs/max_bc.json', 'utf8'));
    for (const x of d.items) {
      if (!x.lat || !x.lon) continue;
      out.push({ origin: 'max', code: 'm', name: x.name || null, address: x.address || null,
        lat: x.lat, lon: x.lon, area: x.area_sqm || null, url: null });
    }
  }
  if (existsSync('docs/arendator_bc.json')) {
    const d = JSON.parse(readFileSync('docs/arendator_bc.json', 'utf8'));
    for (const x of d.items) {
      if (!x.lat || !x.lon) continue;
      out.push({ origin: 'arendator', code: 'a', name: x.name || null, address: x.address || null,
        lat: x.lat, lon: x.lon, area: null, url: x.url || null });
    }
  }
  if (existsSync('docs/reconcile_excel_bc.json')) {
    const d = JSON.parse(readFileSync('docs/reconcile_excel_bc.json', 'utf8'));
    for (const x of d.rows) {
      if (!x.lat || !x.lon) continue;   // без координат — отдельная геокодировка
      out.push({ origin: 'excel2025', code: 'e', name: x.name || null, address: x.addr || null,
        lat: x.lat, lon: x.lon, area: x.area ? Number(String(x.area).replace(/\D/g, '')) || null : null, url: null });
    }
  }
  // Приоритет источника при дедупе: max(0) > arendator(1) > excel(2).
  const pri = { max: 0, arendator: 1, excel2025: 2 };
  out.sort((p, q) => pri[p.origin] - pri[q.origin]);
  return out;
}

export async function ingestExternalBc(registry, { apply = false } = {}) {
  const cand = loadCandidates();
  const byOrigin = (o) => cand.filter((c) => c.origin === o).length;
  console.log(`кандидатов с координатами: ${cand.length} (max=${byOrigin('max')}, arendator=${byOrigin('arendator')}, excel=${byOrigin('excel2025')})`);

  // Все объекты базы с координатами — для отсева «уже есть».
  const base = await registry.sql`
    SELECT lat, lon FROM kosmos.objects WHERE lat IS NOT NULL AND lon IS NOT NULL`;
  console.log(`объектов базы с координатами: ${base.length}`);

  const stats = { matchedBase: 0, dedup: 0, accepted: 0 };
  const acceptedPts = [];   // [{lat, lon}] уже принятых — для дедупа между источниками
  const toInsert = [];

  for (const c of cand) {
    // 2. Уже в базе?
    let inBase = false;
    for (const b of base) {
      if (distM(c.lat, c.lon, b.lat, b.lon) <= MATCH_BASE_M) { inBase = true; break; }
    }
    if (inBase) { stats.matchedBase++; continue; }
    // 3. Дубль среди уже принятых?
    let dup = false;
    for (const p of acceptedPts) {
      if (distM(c.lat, c.lon, p.lat, p.lon) <= DEDUP_M) { dup = true; break; }
    }
    if (dup) { stats.dedup++; continue; }

    acceptedPts.push({ lat: c.lat, lon: c.lon });
    stats.accepted++;
    toInsert.push(c);
  }

  const byOriginAcc = {};
  for (const c of toInsert) byOriginAcc[c.origin] = (byOriginAcc[c.origin] || 0) + 1;
  console.log(`\nотсев: уже в базе ${stats.matchedBase}, дублей между источниками ${stats.dedup}`);
  console.log(`к вставке: ${stats.accepted}`, JSON.stringify(byOriginAcc));

  if (!apply) {
    console.log('\n(dry-run: база не изменена. добавь --apply чтобы записать)');
    console.log('примеры к вставке:');
    for (const c of toInsert.slice(0, 8)) console.log(`  • [${c.origin}] ${c.name} — ${c.address} [${c.lat},${c.lon}] ${c.area ? c.area + ' м²' : ''}`);
    return stats;
  }

  // 4. Вставка. Ключ детерминирован по координатам → идемпотентно.
  let inserted = 0;
  for (const c of toInsert) {
    const cad = `ext:${c.code}:${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    const areaCols = c.area
      ? { area_sqm: c.area, area_source: `${c.origin}_каталог`, area_confidence: 'оценка' }
      : {};
    const titleCols = c.name
      ? { title: c.name, title_source: `${c.origin}_каталог` }
      : {};
    const [res] = await registry.sql`
      INSERT INTO kosmos.objects ${registry.sql({
        cadastral_no: cad,
        object_type: 'бц',
        origin: c.origin,
        address: c.address,
        lat: c.lat,
        lon: c.lon,
        arendator_url: c.url,
        baseline_run: true,   // не подсвечивать как «новое» в первом обходе Димы
        ...areaCols,
        ...titleCols,
      })}
      ON CONFLICT (cadastral_no) DO NOTHING
      RETURNING cadastral_no`;
    if (res) {
      inserted++;
      await registry.recordObservation({
        source: c.origin,
        cadastralNo: cad,
        payload: { name: c.name, address: c.address, lat: c.lat, lon: c.lon, area: c.area },
        sourceUrl: c.url,
      });
    }
  }
  console.log(`\nвставлено новых внешних БЦ: ${inserted}`);
  return { ...stats, inserted };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const registry = new Registry(loadConfig());
  try {
    await ingestExternalBc(registry, { apply });
  } finally {
    await registry.close();
  }
}
