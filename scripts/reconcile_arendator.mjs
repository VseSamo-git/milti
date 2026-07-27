/**
 * Разовая сверка: БЦ ≥10 000 м² из сохранённых страниц Арендатора против нашей
 * базы kosmos.objects. Только ЧТЕНИЕ базы — ничего не пишет. Цель: понять,
 * какие крупные БЦ Арендатор знает, а наш реестр 700-ПП — нет.
 *
 * Источник Арендатора: JSON-LD (schema.org ItemList/Place) на страницах — там
 * адрес и координаты чисто, без парсинга вёрстки. Название БЦ берём из карточки
 * по id объекта из url. Фильтр страниц: square_total:10000, geo Москва.
 *
 * Запуск: node run.js scripts/reconcile_arendator.mjs
 */
import fs from 'node:fs';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';
import { distanceMeters } from '../src/lib/nearest.js';

const DIR = 'Арендатор';
const MATCH_M = 150; // порог совпадения БЦ ↔ здание из базы

const clean = (s) => (s || '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function parseArendator() {
  const files = fs.readdirSync(DIR).filter((n) => n.toLowerCase().endsWith('.html')).sort();
  const byKey = new Map();
  for (const file of files) {
    const html = fs.readFileSync(`${DIR}/${file}`, 'utf8');

    // id объекта → видимое название БЦ (из ссылки-карточки)
    const names = new Map();
    for (const m of html.matchAll(/href="[^"]*\/objects\/(\d+)-[^"]*"[^>]*>([^<]{2,120})</g)) {
      const name = clean(m[2]);
      if (name && !/^\s*$/.test(name) && !names.has(m[1])) names.set(m[1], name);
    }

    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      let data;
      try { data = JSON.parse(block[1]); } catch { continue; }
      if (!Array.isArray(data.itemListElement)) continue;
      for (const el of data.itemListElement) {
        const p = el.item || el;
        if (!p.geo) continue;
        const lat = Number(p.geo.latitude);
        const lon = Number(p.geo.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const address = clean(typeof p.address === 'string' ? p.address : p.address?.name);
        const id = (p.url || '').match(/\/objects\/(\d+)-/)?.[1];
        const name = id && names.get(id);
        const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
        if (!byKey.has(key)) byKey.set(key, { name: name || null, address, lat, lon, url: p.url });
      }
    }
  }
  return [...byKey.values()];
}

async function main() {
  const bc = parseArendator();
  console.log(`Арендатор: уникальных БЦ по координатам — ${bc.length}`);
  console.log(`  с названием: ${bc.filter((x) => x.name).length}, с адресом: ${bc.filter((x) => x.address).length}`);

  const cfg = loadConfig();
  const sql = postgres(cfg.dbUrl, { ssl: 'require', max: 1 });
  try {
    const rows = await sql`
      SELECT id, cadastral_no, address, lat, lon, area_sqm, object_type, annex
      FROM kosmos.objects
      WHERE lat IS NOT NULL AND lon IS NOT NULL`;
    console.log(`База: объектов с координатами — ${rows.length}`);

    const matched = [];
    const missing = [];
    for (const b of bc) {
      let best = null;
      let bestD = Infinity;
      for (const o of rows) {
        const d = distanceMeters(b.lat, b.lon, o.lat, o.lon);
        if (d < bestD) { bestD = d; best = o; }
      }
      if (best && bestD <= MATCH_M) matched.push({ b, o: best, d: Math.round(bestD) });
      else missing.push({ b, nearestM: Math.round(bestD) });
    }

    console.log(`\n=== ИТОГ сверки (порог ${MATCH_M} м) ===`);
    console.log(`Совпало с базой:   ${matched.length}`);
    console.log(`НЕТ в базе:        ${missing.length}`);

    const enriched = matched.filter((m) => m.o.area_sqm != null).length;
    const asBC = matched.filter((m) => m.o.object_type === 'бц').length;
    console.log(`  из совпавших: с площадью ${enriched}, помечены как «бц» ${asBC}`);

    if (missing.length) {
      console.log(`\n=== БЦ Арендатора, которых НЕТ в базе (${missing.length}) ===`);
      for (const m of missing) {
        console.log(`  • ${m.b.name || '(без названия)'} — ${m.b.address || '?'}  [до ближайшего ${m.nearestM} м]  ${m.b.url}`);
      }
    }

    // сохраним полный отчёт рядом, чтобы можно было решать по вставке
    const report = { generatedFor: '≥10000 м² Москва (Арендатор)', matchThresholdM: MATCH_M, counts: { arendator: bc.length, matched: matched.length, missing: missing.length }, missing: missing.map((m) => ({ ...m.b, nearestM: m.nearestM })), matchedSample: matched.slice(0, 20).map((m) => ({ name: m.b.name, address: m.b.address, d: m.d, cadastral_no: m.o.cadastral_no, area_sqm: m.o.area_sqm, object_type: m.o.object_type })) };
    fs.writeFileSync('docs/reconcile_arendator.json', JSON.stringify(report, null, 1));
    console.log(`\nПолный отчёт: docs/reconcile_arendator.json`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
