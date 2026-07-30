/**
 * Сверка «На проверку» с «Базой»: убрать точные дубли, пометить неоднозначные.
 *
 * Одно здание живёт в базе несколькими строками (дробление кадастра + внешний
 * каталог). Часть очереди «На проверку» — тот же адрес, что уже стоит лидом в
 * «Базе». Два уровня совпадения:
 *
 *   ТОЧНОЕ  (координата ≤50 м ИЛИ полностью тот же адрес) → status='дубль_в_базе',
 *           строка уходит из очереди. Это заведомо тот же объект.
 *   НЕТОЧНОЕ (та же улица + базовый номер дома, ≤500 м) → пишем подсказку в
 *           baza_dubl_hint, но НЕ прячем: в плотном кластере один адрес бывает у
 *           разных зданий (Королёва 13). Решает Дима, глядя на флаг.
 *
 * Запуск: node run.js ./scripts/reconcile_proverka.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';
import { isMain } from '../src/lib/is_main.js';

const R = 6371000, rad = (d) => d * Math.PI / 180;
const distM = (a, b, c, d) => { const dLa = rad(c - a), dLo = rad(d - b); const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

const ADMIN = /\b(российская федерация|г\.?|город|москва|московская|обл\.?|область|мо|поселение|деревня|д\.|рп|пгт|вн\.?тер\.?г\.?|муниципальный округ|район|р-н|ао|зао|сао|свао|юао|юзао|сзао|ювао|цао|нао|тао)\b/g;
const STREETTYPE = /\b(улица|ул|проспект|пр-кт|пр-т|проезд|переулок|пер|шоссе|ш|бульвар|б-р|бул|набережная|наб|площадь|пл|аллея|линия|тупик|квартал|кв-л)\b\.?/g;
const HOUSEWORD = /\b(дом|корпус|корп|кор|строение|стр|владение|вл|литера|лит)\b\.?/g;

function norm(s) {
  return ` ${String(s).toLowerCase().replace(/ё/g, 'е')} `
    .replace(ADMIN, ' ').replace(STREETTYPE, ' ').replace(HOUSEWORD, ' ');
}
// Полный ключ: улица + ВСЕ числа (корпус/строение включительно). Совпал —
// это буквально та же строка адреса.
function addrKey(s) {
  if (!s) return null;
  const t = norm(s).replace(/[^0-9a-zа-я]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter((w) => /[а-яa-z]/.test(w) && w.length > 2);
  const nums = t.split(' ').filter((w) => /\d/.test(w));
  if (!words.length || !nums.length) return null;
  return words.sort().join(' ') + '|' + nums.sort().join(' ');
}
// Разбор адреса: множество слов-улиц + номер дома (без корпуса/строения).
// Внешние адреса тащат лишнее слово-район («СВАО, Бутырский, ...»), поэтому
// сравниваем не по полному совпадению строки, а по номеру дома + пересечению
// слов улицы — тогда «Бутырский Огородный 16» и «Огородный 16/1» совпадут по
// {огородный}+16, а «Мира 1» и «Профсоюзная 1» — нет.
function parseAddr(s) {
  const toks = norm(s).replace(/[^0-9a-zа-я/]+/g, ' ').split(/\s+/).filter(Boolean);
  const words = new Set(toks.filter((w) => /^[а-яa-z]+$/.test(w) && w.length > 2));
  const houseTok = toks.find((w) => /\d/.test(w));
  const house = houseTok ? houseTok.split('/')[0].match(/\d+/)?.[0] || null : null;
  return { words, house };
}

// Координаты во вьюхах — строка "lat, lon". Разбираем в числа.
function coords(s) {
  if (!s) return [null, null];
  const [a, b] = String(s).split(',').map((x) => parseFloat(x));
  return [Number.isFinite(a) ? a : null, Number.isFinite(b) ? b : null];
}

export async function reconcile(cfg, { apply = false } = {}) {
  const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });
  try {
    // Читаем ПРЯМО из вьюх — это ровно то, что видит Дима, без дрейфа
    // предикатов. «Ключ» = kosmos.objects.cadastral_no. Места (ВУЗ/НИИ,
    // 'place:...') из Базы исключаем — БЦ по адресу с ними не путаем.
    const bazaRaw = await sql.unsafe(`SELECT "Ключ" cad, "Название" title, "Адрес" addr, "Координаты" coord FROM vitrina."База" WHERE "Ключ" NOT LIKE 'place:%'`);
    const provRaw = await sql.unsafe(`SELECT "Ключ" cad, "Название" title, "Адрес" addr, "Координаты" coord FROM vitrina."На проверку"`);
    const baza = bazaRaw.map((r) => { const [lat, lon] = coords(r.coord); return { cadastral_no: r.cad, title: r.title, address: r.addr, addr_short: r.addr, lat, lon }; });
    const prov = provRaw.map((r) => { const [lat, lon] = coords(r.coord); return { cadastral_no: r.cad, title: r.title, address: r.addr, lat, lon }; });
    console.log(`База: ${baza.length} | На проверку: ${prov.length}`);

    const named = (t) => t && t !== '(без названия)' ? t : null;
    const label = (o) => named(o.title) || o.addr_short || '(без названия)';

    // Предрасчёт по Базе: полный ключ, слова+дом, координаты.
    const bazaParsed = baza.map((o) => ({ o, full: addrKey(o.address), ...parseAddr(o.address) }));

    const exact = [];   // {cad} → status='дубль_в_базе'
    const hints = [];   // {cad, hint} → baza_dubl_hint
    for (const p of prov) {
      const pf = addrKey(p.address);
      const pp = parseAddr(p.address);
      let exactHit = null, looseHit = null, looseD = Infinity;
      for (const bp of bazaParsed) {
        const d = (p.lat != null && bp.o.lat != null) ? distM(p.lat, p.lon, bp.o.lat, bp.o.lon) : Infinity;
        // ТОЧНОЕ: координата ≤50 м ИЛИ полностью тот же адрес.
        if (d <= 50 || (pf && bp.full && pf === bp.full)) { exactHit = bp.o; break; }
        // НЕТОЧНОЕ: тот же номер дома + пересечение слов улицы + ≤300 м.
        if (pp.house && bp.house === pp.house && d <= 300) {
          let overlap = false;
          for (const w of pp.words) if (bp.words.has(w)) { overlap = true; break; }
          if (overlap && d < looseD) { looseD = d; looseHit = bp.o; }
        }
      }
      if (exactHit) { exact.push({ cad: p.cadastral_no }); continue; }
      if (looseHit) hints.push({ cad: p.cadastral_no, hint: `похоже уже в Базе: «${label(looseHit)}» (~${Math.round(looseD)} м)` });
      else hints.push({ cad: p.cadastral_no, hint: null }); // очистить устаревший флаг
    }
    const flagged = hints.filter((h) => h.hint);
    console.log(`точных дублей (убрать): ${exact.length} | помечено флагом: ${flagged.length}`);
    for (const h of flagged.slice(0, 15)) console.log(`  ⚠ [${h.cad}] ${h.hint}`);

    if (!apply) { console.log('\n(dry-run: --apply чтобы записать)'); return { exact: exact.length, flagged: flagged.length }; }

    if (exact.length) {
      await sql`UPDATE kosmos.objects SET status='дубль_в_базе', subtract_reason='адрес уже есть лидом в Базе'
        WHERE cadastral_no = ANY(${exact.map((e) => e.cad)}) AND status='активен'`;
    }
    // Подсказки: пишем и проставленные, и очищенные (NULL) — одним проходом.
    for (const h of hints) {
      await sql`UPDATE kosmos.objects SET baza_dubl_hint=${h.hint} WHERE cadastral_no=${h.cad} AND baza_dubl_hint IS DISTINCT FROM ${h.hint}`;
    }
    console.log(`\nубрано дублей: ${exact.length}, флагов проставлено: ${flagged.length}`);
    return { exact: exact.length, flagged: flagged.length };
  } finally { await sql.end({ timeout: 5 }); }
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  await reconcile(loadConfig(), { apply });
}
