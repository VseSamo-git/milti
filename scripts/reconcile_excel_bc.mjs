/**
 * Разовая сверка: лист «БЦ введённые 2025–2026» из Excel Димы против базы.
 * Это НОВЫЕ БЦ (новостройки), которых в статическом реестре 700-ПП, скорее
 * всего, нет — самые горячие лиды. Только чтение базы.
 *
 * Excel уже распакован (xlsx = zip) во временную папку; путь — первый аргумент.
 * Запуск: node scripts/reconcile_excel_bc.mjs <путь-к-распакованному-xlsx>
 */
import fs from 'node:fs';
import postgres from 'postgres';
import { loadConfig } from '../src/config.js';

// .env вручную (без run.js — он сдвигает argv)
for (const line of fs.readFileSync('.env', 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  process.env[t.slice(0, i)] = t.slice(i + 1);
}

const base = process.argv[2];
const ents = (s) => (s || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const dec = (s) => ents(s).replace(/\s+/g, ' ').trim();

const xml = fs.readFileSync(`${base}/xl/worksheets/sheet1.xml`, 'utf8');
const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
  const cells = {};
  for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)) {
    const [, col, t, body] = c;
    const v = t === 'inlineStr'
      ? (body.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '')
      : (body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
    cells[col] = dec(v);
  }
  return cells;
});
const data = rows.slice(1).filter((r) => r.A).map((r) => ({ name: r.A, addr: r.B, area: r.C, date: r.D, cls: r.E, dev: r.F, note: r.G }));

const norm = (s) => ents(s || '').toLowerCase().replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/g, ' ')
  .replace(/\b(улица|ул|проспект|пр|проезд|бульвар|шоссе|набережная|наб|переулок|пер|корпус|стр|строение|дом)\b/g, ' ')
  .replace(/\s+/g, ' ').trim();
const houseNo = (s) => ents(s || '').toLowerCase().match(/\b\d+[а-я]?\b/g) || [];

const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: 'require', max: 1 });
try {
  const objs = await sql`SELECT address, area_sqm FROM kosmos.objects WHERE address IS NOT NULL`;
  console.log(`Новых БЦ в Excel: ${data.length} | адресов в базе: ${objs.length}\n`);
  const idx = objs.map((o) => ({ raw: o.address, n: norm(o.address), h: new Set(houseNo(o.address)) }));

  let inBase = 0;
  for (const b of data) {
    const words = norm(b.addr).split(' ').filter((w) => w.length > 3);
    const bh = houseNo(b.addr);
    const hit = idx.find((o) => bh.some((h) => o.h.has(h)) && words.some((w) => o.n.includes(w)));
    if (hit) inBase++;
    console.log(`${hit ? '✓ ЕСТЬ' : '✗ НЕТ '} | ${b.name} — ${b.addr} | ${b.area} м² ${b.cls} | ${b.date}${hit ? '  ⟶ ' + hit.raw : ''}`);
  }
  console.log(`\nИТОГ: похоже есть в базе ~${inBase} из ${data.length}; вероятно НОВЫХ ${data.length - inBase}`);
  fs.writeFileSync('docs/reconcile_excel_bc.json', JSON.stringify({ source: 'БЦ_новые_2025-2026.xlsx / лист «БЦ введённые 2025–2026»', count: data.length, rows: data }, null, 1));
  console.log('Сохранил: docs/reconcile_excel_bc.json');
} finally {
  await sql.end({ timeout: 5 });
}
