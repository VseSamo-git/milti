// Дельта-дамп безымянных, не попавших в основной noname_all.json:
// ТЦ (ретейл-объекты), средние БЦ (если не покрыты), НИИ (places).
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
import { readFileSync, writeFileSync } from 'node:fs';
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
const already = new Set(
  JSON.parse(readFileSync('docs/noname_all.json', 'utf8')).map((r) => r.cadastral_no));
try {
  const out = [];

  // 1. ТЦ с супермаркетом — объекты, o.title пуст
  const tc = await sql`
    SELECT DISTINCT o.cadastral_no, round(o.area_sqm)::int area, o.address, o.lat, o.lon
    FROM kosmos.objects o JOIN kosmos.places p ON p.object_id=o.id
    WHERE p.kind='супермаркет' AND o.title IS NULL AND o.address IS NOT NULL`;
  for (const r of tc) if (!already.has(r.cadastral_no))
    out.push({ key: r.cadastral_no, tbl: 'obj', kind: 'тц', area: r.area, address: r.address });

  // 2. Средние БЦ 5-10к без названия
  const sr = await sql.unsafe(
    `SELECT "Кадастровый номер" cad, "Адрес" address, "Общая площадь, м²" area
     FROM vitrina."8 БЦ средние 5-10к" WHERE "Название БЦ" IS NULL`);
  for (const r of sr) if (!already.has(r.cad))
    out.push({ key: r.cad, tbl: 'obj', kind: 'средние', area: r.area, address: r.address });

  // 3. НИИ из places без имени
  const nii = await sql`
    SELECT p.id, p.lat, p.lon, coalesce(p.address, o.address) address
    FROM kosmos.places p LEFT JOIN kosmos.objects o ON o.id=p.object_id
    WHERE p.kind='нии' AND (p.name IS NULL OR trim(p.name)='')`;
  for (const r of nii)
    out.push({ key: 'place:' + r.id, tbl: 'place', place_id: r.id, kind: 'нии', address: r.address, lat: r.lat, lon: r.lon });

  writeFileSync('docs/noname_extra.json', JSON.stringify(out, null, 1));
  const by = {};
  for (const r of out) by[r.kind] = (by[r.kind] || 0) + 1;
  console.log('дельта безымянных:', out.length, JSON.stringify(by));
} finally { await sql.end({ timeout: 5 }); }
