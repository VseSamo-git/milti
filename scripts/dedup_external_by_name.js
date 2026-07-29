/**
 * Доп. сверка внешних БЦ по НАЗВАНИЯМ (не только координатам).
 *
 * ЗАЧЕМ. Ингест внешних (ingest_external_bc.js) отсеивал дубли по координатам
 * ≤80 м. Но у Арендатора координата геокодится из адреса и может уехать
 * дальше 80 м — тогда БЦ, уже стоящий в базе, влился повторно. Ловим такие
 * по имени: транслитерируем кириллицу в латиницу (имена Арендатора — латиница
 * из слага), нормализуем, сравниваем.
 *
 * ПРЕДОХРАНИТЕЛЬ. Точное совпадение имени удаляем только при дистанции ≤ 2 км
 * (ошибка геокодинга реалистична, а два РАЗНЫХ одноимённых БЦ в 2 км — почти
 * невозможно; сетевые «Апсайд Кунцево»/«Апсайд …» различаются словом-локацией).
 * Слабые совпадения (пересечение токенов) только показываем — не трогаем.
 *
 * Удаляем ТОЛЬКО внешние строки (origin IS NOT NULL) — реестр не трогаем.
 * Запуск: node run.js ./scripts/dedup_external_by_name.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';

const MAP = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'ju',я:'ja' };
const translit = (s) => (s || '').toLowerCase().split('').map((c) => (c in MAP ? MAP[c] : c)).join('');
// Общие слова БЦ выкидываем — они не различают объекты.
const STOP = /\b(bc|bts|biznes|business|centr|center|centre|kompleks|complex|plaza|tower|bashnja|dom|zdanie|ofis|office|park|the|na|i|im|imeni)\b/g;
const norm = (s) => translit(s).replace(/[^a-z0-9 ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

const R = 6371000, rad = (d) => (d * Math.PI) / 180;
const distM = (aLat, aLon, bLat, bLon) => {
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

export async function dedupByName(registry, { apply = false } = {}) {
  // Кандидаты на удаление — внешние с именем.
  const ext = await registry.sql`
    SELECT id, cadastral_no, origin, title, lat, lon FROM kosmos.objects
    WHERE origin IS NOT NULL AND title IS NOT NULL AND lat IS NOT NULL`;
  // Все остальные объекты с именем — против кого сверяем.
  const others = await registry.sql`
    SELECT id, origin, title, lat, lon FROM kosmos.objects
    WHERE title IS NOT NULL AND lat IS NOT NULL`;

  // Кого оставляем при паре дублей: меньше число = каноничнее.
  // Реестр (0) не трогаем никогда; из внешних приоритет у Макса (есть площадь).
  const pri = (origin) => (origin === null ? 0 : origin === 'max' ? 1 : origin === 'arendator' ? 2 : 3);

  const idx = others.map((o) => ({ ...o, n: norm(o.title) })).filter((o) => o.n.length >= 4);
  const remove = [];
  const weak = [];
  for (const e of ext) {
    const en = norm(e.title);
    if (en.length < 4) continue;
    const eToks = new Set(en.split(' '));
    let hit = null, weakHit = null;
    for (const o of idx) {
      if (o.id === e.id) continue;
      const d = distM(e.lat, e.lon, o.lat, o.lon);
      if (o.n === en && d <= 2000) { hit = { o, d }; break; }
      const oToks = new Set(o.n.split(' '));
      const inter = [...eToks].filter((t) => oToks.has(t)).length;
      const jac = inter / new Set([...eToks, ...oToks]).size;
      if (inter >= 2 && jac >= 0.6 && d <= 2000 && !weakHit) weakHit = { o, d, jac };
    }
    if (hit) {
      // Удаляем e ТОЛЬКО если пара оставляет каноничным именно o
      // (o приоритетнее, либо равный приоритет но меньший id). Иначе e — keeper.
      const pe = pri(e.origin), po = pri(hit.o.origin);
      if (po < pe || (po === pe && hit.o.id < e.id)) remove.push({ e, ...hit });
    } else if (weakHit) weak.push({ e, ...weakHit });
  }

  console.log(`внешних с именем: ${ext.length}`);
  console.log(`\n=== ТОЧНОЕ совпадение имени + ≤2км → дубль, удаляем (${remove.length}) ===`);
  for (const r of remove) console.log(`  ✗ [${r.e.origin}] «${r.e.title}» ≈ «${r.o.title}» (${Math.round(r.d)}м, ${r.o.origin || 'реестр'})`);
  console.log(`\n=== СЛАБОЕ совпадение (только показ, НЕ трогаю) (${weak.length}) ===`);
  for (const w of weak.slice(0, 30)) console.log(`  ? [${w.e.origin}] «${w.e.title}» ~ «${w.o.title}» (${Math.round(w.d)}м, jac ${w.jac.toFixed(2)})`);

  if (!apply) { console.log('\n(dry-run: добавь --apply чтобы удалить точные дубли)'); return { remove: remove.length, weak: weak.length }; }
  if (remove.length) {
    const ids = remove.map((r) => r.e.id);
    const del = await registry.sql`DELETE FROM kosmos.objects WHERE id = ANY(${ids}) AND origin IS NOT NULL RETURNING id`;
    console.log(`\nудалено дублей: ${del.length}`);
  }
  return { remove: remove.length, weak: weak.length };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const registry = new Registry(loadConfig());
  try { await dedupByName(registry, { apply }); }
  finally { await registry.close(); }
}
