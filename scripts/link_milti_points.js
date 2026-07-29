/**
 * Точки МИЛТИ → база: ингест списков и вычитание.
 *
 * Дима даёт два списка (обновляет раз в 3 мес): работающие и закрытые точки
 * доставки МИЛТИ. По этим адресам БЦ уже не ищем — их надо вычесть из базы.
 *
 * Матч здания базы к точке — двойной сигнал (Дима: «точнее лучше + по названиям»):
 *   1) координаты ≤ 30 м (точное здание);
 *   2) совпадение нормализованного адреса (улица+дом) — ловит случай, когда
 *      координата чуть врёт, но адрес тот же.
 * Совпал с работающей → status='вычтен_наша_точка'; с закрытой → 'вычтен_закрытая_точка'.
 * Работающая имеет приоритет (там точка живёт сейчас).
 *
 * Идемпотентно: таблицы точек пересоздаются из CSV, статусы вычтенных
 * пересчитываются. Провенанс — subtract_reason.
 *
 * Запуск:  node run.js ./scripts/link_milti_points.js [--apply]
 * Без --apply — только замер, база не меняется.
 */
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';

const CSV_DIR = process.env.KOSMOS_MILTI_CSV_DIR ||
  'C:/Users/pocht/AppData/Local/Temp/claude/c--Users-pocht-Documents------/5f5667f2-8a82-4954-a30e-2437cf275d2b/scratchpad/';
const THRESHOLD_M = 30;

function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; } if (c === '\r' && text[i + 1] === '\n') i++; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const readCsv = (f) => parseCsv(readFileSync(CSV_DIR + f, 'utf8').replace(/^\uFEFF/, ''));
const geo = (s) => { const m = (s || '').match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null; };

// Нормализованный ключ адреса: улица + дом, без шума. ё→е, тип улицы/дома убран.
function addrKey(s) {
  if (!s) return null;
  let t = ` ${s.toLowerCase().replace(/ё/g, 'е')} `;
  t = t.replace(/\b(российская федерация|г\.?|город|москва|московская|обл\.?|область|мо|поселение|деревня|д\.|рп|пгт|вн\.?тер\.?г\.?|муниципальный округ|район|р-н|ао|зао|сао|свао|юао|юзао|сзао|ювао|цао|нао|тао)\b/g, ' ');
  t = t.replace(/\b(улица|ул|проспект|пр-кт|пр-т|проезд|переулок|пер|шоссе|ш|бульвар|б-р|бул|набережная|наб|площадь|пл|аллея|линия|тупик|квартал|кв-л)\b\.?/g, ' ');
  t = t.replace(/\b(дом|корпус|корп|кор|строение|стр|владение|вл|литера|лит)\b\.?/g, ' ');
  // «24к3» / «2а» → цифры и буквы дома оставляем, разделители чистим
  t = t.replace(/[^0-9a-zа-я]+/g, ' ').replace(/\s+/g, ' ').trim();
  // ключ = слова-буквы (улица) + все числа (дом/корпус), отсортированы
  const words = t.split(' ').filter((w) => /[а-яa-z]/.test(w) && w.length > 2);
  const nums = t.split(' ').filter((w) => /\d/.test(w));
  if (!words.length || !nums.length) return null;
  return words.sort().join(' ') + '|' + nums.sort().join(' ');
}

const R = 6371000, rad = (d) => d * Math.PI / 180;
const distM = (a, b, c, d) => { const dLa = rad(c - a), dLo = rad(d - b); const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

export async function linkMiltiPoints(registry, { apply = false, rematch = false } = {}) {
  // Режим --rematch: точки уже в БД (CSV мог остаться на другой машине).
  // Берём их из our_points/closed_points и только пере-вычитаем — это ловит
  // и внешние БЦ, влитые ПОСЛЕ первого вычитания.
  let work, closed;
  if (rematch) {
    const toPt = (r) => ({ name: r.name, addr: r.address_raw, geo: r.lat != null ? [r.lat, r.lon] : null });
    work = (await registry.sql`SELECT name, address_raw, lat, lon FROM kosmos.our_points`).map(toPt);
    closed = (await registry.sql`SELECT name, address_raw, lat, lon FROM kosmos.closed_points`).map(toPt);
    console.log(`[rematch из БД] точки: работающих ${work.length}, закрытых ${closed.length}`);
  } else {
  // work: [TITLE, LOCAL_ADDRESS, GEO_POINT]; closed: [TITLE, FINE_LOCATION, LOCAL_ADDRESS, GEO_POINT]
  work = readCsv('Открытые_и_закрытые_точки__work.csv').slice(1)
    .map((r) => ({ name: r[0], addr: r[1], geo: geo(r[2]) })).filter((x) => x.addr || x.geo);
  closed = readCsv('Открытые_и_закрытые_точки__closed.csv').slice(1)
    .map((r) => ({ name: r[0], addr: r[2], geo: geo(r[3]) })).filter((x) => x.addr || x.geo);
  console.log(`точки: работающих ${work.length}, закрытых ${closed.length}`);
  }

  if (apply && !rematch) {
    await registry.sql`TRUNCATE kosmos.our_points RESTART IDENTITY`;
    await registry.sql`TRUNCATE kosmos.closed_points RESTART IDENTITY`;
    const ins = (tbl, pts) => pts.length ? registry.sql`
      INSERT INTO ${tbl} (name, address_raw, lat, lon)
      VALUES ${registry.sql(pts.map((p) => [p.name || null, p.addr || '(нет адреса)', p.geo?.[0] ?? null, p.geo?.[1] ?? null]))}` : null;
    await ins(registry.sql`kosmos.our_points`, work);
    await ins(registry.sql`kosmos.closed_points`, closed);
    console.log('точки загружены в our_points / closed_points');
  }

  const objs = await registry.sql`SELECT cadastral_no, lat, lon, address FROM kosmos.objects`;
  // индекс адресных ключей базы
  const byAddr = new Map();
  for (const o of objs) { const k = addrKey(o.address); if (k) { if (!byAddr.has(k)) byAddr.set(k, []); byAddr.get(k).push(o.cadastral_no); } }

  function hits(points) {
    const set = new Set();
    for (const p of points) {
      // 1) координаты ≤30м
      if (p.geo) for (const o of objs) { if (o.lat != null && distM(p.geo[0], p.geo[1], o.lat, o.lon) <= THRESHOLD_M) set.add(o.cadastral_no); }
      // 2) адрес/название
      const k = addrKey(p.addr || p.name);
      if (k && byAddr.has(k)) for (const cad of byAddr.get(k)) set.add(cad);
    }
    return set;
  }
  const ourHits = hits(work);
  const closedHits = hits(closed);
  // работающая имеет приоритет
  for (const c of ourHits) closedHits.delete(c);
  console.log(`вычитается: наша точка ${ourHits.size} + закрытая ${closedHits.size} = ${ourHits.size + closedHits.size}`);

  if (apply) {
    const upd = (cads, status, reason) => cads.size ? registry.sql`
      UPDATE kosmos.objects SET status = ${status}, subtract_reason = ${reason}
      WHERE cadastral_no = ANY(${[...cads]})` : null;
    await upd(ourHits, 'вычтен_наша_точка', 'адрес работающей точки МИЛТИ');
    await upd(closedHits, 'вычтен_закрытая_точка', 'адрес закрытой точки МИЛТИ');
    console.log('статусы вычтенных проставлены');
  } else {
    console.log('(dry-run: база не изменена, добавь --apply чтобы записать)');
  }
  return { our: ourHits.size, closed: closedHits.size };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const rematch = process.argv.includes('--rematch');
  const registry = new Registry(loadConfig());
  try { await linkMiltiPoints(registry, { apply, rematch }); }
  finally { await registry.close(); }
}
