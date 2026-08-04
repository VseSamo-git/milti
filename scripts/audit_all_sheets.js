/**
 * Аудит ВСЕХ листов витрины — структурная проверка + точечная гео-сверка.
 *
 * Делает то же, что внешний файл БАЗА_сверка.xlsx, но по всем листам сразу и
 * своими силами. Две части:
 *
 *  1. СТРУКТУРА (без сети) — по каждой строке листа считаем флаги качества:
 *     дубли имени/адреса/координат, «не здание» (OSM-точка), без названия,
 *     нет адреса/координат, площадь ниже порога, аномальная этажность,
 *     объект вплотную к точке Милти (должен был вычесться), совпадение с Базой.
 *
 *  2. ГЕО-СВЕРКА (--geo N, Nominatim reverse) — для N самых подозрительных
 *     строк берём координату → канонический адрес справочника → сравниваем
 *     улицу и номер дома с адресом в базе. Ключ не нужен (reverse-геокодер
 *     бесплатный). Ловит «ОКО д.19 против д.21», расхождения номеров.
 *
 * Координаты/площадь/этажи, если их нет в самом листе, добираем по «Ключ»
 * из kosmos.objects (кадастр) или kosmos.places (place:<id>).
 *
 * Запуск:  node run.js ./scripts/audit_all_sheets.js [--geo 200] [--xlsx путь]
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';
import { geocode as yandexGeo, budgetLeft, budgetUsed, DAILY_CAP } from '../src/lib/yandex.js';

// --- нормализаторы ----------------------------------------------------------
const PREFIX = /^(бц|тц|трц|тк|бизнес[- ]центр|бизнес[- ]парк|деловой центр|деловой квартал|торговый центр|торгово-развлекательн\w*|комплекс|мфк|апарт\w*)\s+/i;
function nameKey(s) {
  if (!s) return '';
  let x = String(s).toLowerCase().replace(/[«»"'`”“„]/g, ' ').replace(/\s+/g, ' ').trim();
  x = x.replace(PREFIX, '').trim();
  x = x.replace(/[^a-zа-я0-9 ]/gi, '').replace(/\s+/g, ' ').trim();
  return x.length >= 4 ? x : '';
}
// слова улицы + базовый номер дома (без корпус/строение/литера) — для кластера,
// и полный ключ (с корпусом/строением) — для строгого дубля «то же здание».
function addrParts(s) {
  if (!s) return { key: '', full: '', words: new Set(), house: '' };
  let x = String(s).toLowerCase();
  x = x.replace(/\bг\.?\s*москва\b|\bмосква\b|\bг\.?\s*/g, ' ');
  x = x.replace(/\b(улица|ул|переулок|пер|проспект|пр-?т|проезд|пр-?д|набережная|наб|бульвар|б-?р|шоссе|ш|площадь|пл|аллея|линия|тупик)\b\.?/g, ' ');
  const houseM = x.match(/(?:дом|д|владение|влд|двлд)?\.?\s*(\d+)\s*([а-я])?/);
  const house = houseM ? (houseM[1] + (houseM[2] || '')) : '';
  const words = new Set(
    x.replace(/[^a-zа-я0-9 ]/gi, ' ').split(/\s+/)
      .filter((w) => w && !/^\d/.test(w) && w.length >= 3 && !/^(дом|стр|корп|литер|этаж|пом|офис)/.test(w))
  );
  // полный ключ: улица-слова + все цифро-буквенные токены (дом, корпус, строение)
  const nums = (x.match(/\d+[а-я]?/g) || []).join(',');
  const full = [...words].sort().join(' ') + '|' + nums;
  return { key: [...words].sort().join(' ') + '|' + house, full, words, house };
}
const R = 6371000, rad = (d) => d * Math.PI / 180;
function distM(a, b, c, d) {
  const x = rad(c - a), y = rad(d - b);
  const s = Math.sin(x / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
// базовый номер дома из адреса базы: только цифры+опц.буква после «дом/д», без
// корпус/строение. Возвращаем {digits, letter} для устойчивого сравнения.
function baseHouse(addr) {
  const s = String(addr || '');
  // токен дома должен стоять после начала строки/пробела/запятой — иначе цепляем
  // хвостовую «д» из «проезД» и цифру порядковой улицы («1-й»). JS \b с кириллицей
  // не работает, поэтому явный разделитель.
  const m = s.match(/(?:^|[\s,])(?:дом|д|влд|двлд)\.?\s+(\d{1,3})\s*([а-яА-Я])?/i);
  return m ? { d: m[1], l: (m[2] || '').toLowerCase() } : null;
}
// номер дома из структурного house_number Nominatim (может быть «12к1», «12 с1»)
function hitHouse(h) {
  const m = String(h || '').match(/^(\d{1,3})\s*([а-яА-Яa-zA-Z])?/);
  return m ? { d: m[1], l: (m[2] || '').toLowerCase() } : null;
}

// --- какие листы аудитим и как читать колонки ------------------------------
const SHEETS = [
  { v: 'База',              name: 'Название',        addr: 'Адрес', area: 'Площадь, м²',       floors: 'Этажей', key: 'Ключ', coords: 'Координаты', minArea: 10000 },
  { v: 'На проверку',       name: 'Название',        addr: 'Адрес', area: 'Площадь, м²',       floors: 'Этажей', key: 'Ключ', coords: 'Координаты', minArea: 0, xBaza: true },
  { v: 'БЦ средние 5-10к',  name: 'Название БЦ',     addr: 'Адрес', area: 'Общая площадь, м²', floors: 'Этажей', key: 'Ключ', minArea: 5000 },
  { v: 'ТЦ с супермаркетом',name: 'Название ТЦ',     addr: 'Адрес', area: 'Общая площадь, м²', floors: 'Этажей', key: 'Ключ', minArea: 0 },
  { v: 'Конкуренты',        name: 'Сеть',            addr: 'Адрес', key: 'Ключ', minArea: 0, chain: true },
  { v: 'Открытые точки',    name: 'Название',        addr: 'Адрес', coords: 'Координаты', minArea: 0, ref: true },
  { v: 'Закрытые точки',    name: 'Название',        addr: 'Адрес', coords: 'Координаты', minArea: 0, ref: true },
];

function parseCoords(s) {
  const n = String(s || '').match(/-?\d+\.\d+/g);
  return n && n.length >= 2 ? [parseFloat(n[0]), parseFloat(n[1])] : [null, null];
}

async function readSheet(r, cfg) {
  const q = (col) => (col ? `v."${col}"` : 'NULL');
  const sel = [
    `${q(cfg.name)} AS name`, `${q(cfg.addr)} AS addr`,
    `${q(cfg.area)} AS area`, `${q(cfg.floors)} AS floors`,
    `${q(cfg.key)} AS key`, `${q(cfg.coords)} AS coords`,
  ].join(', ');
  const rows = await r.sql.unsafe(`SELECT ${sel} FROM vitrina."${cfg.v}" v`);
  // добираем координаты и близость к Милти по ключу
  const cads = rows.filter((x) => x.key && !String(x.key).startsWith('place:')).map((x) => x.key);
  const pids = rows.filter((x) => x.key && String(x.key).startsWith('place:')).map((x) => Number(String(x.key).slice(6)));
  const oMap = new Map(), pMap = new Map();
  if (cads.length) {
    const os = await r.sql`SELECT cadastral_no, lat, lon, nearest_point_m, nearest_point_name FROM kosmos.objects WHERE cadastral_no = ANY(${cads})`;
    for (const o of os) oMap.set(o.cadastral_no, o);
  }
  if (pids.length) {
    const ps = await r.sql`SELECT id, lat, lon FROM kosmos.places WHERE id = ANY(${pids})`;
    for (const p of ps) pMap.set(Number(p.id), p);
    if (process.env.AUDIT_DBG) console.log(`  DBG ${cfg.v}: pids=${pids.length} pMap=${pMap.size} sample=${JSON.stringify(ps[0]||null)}`);
  }
  for (const x of rows) {
    let lat = null, lon = null, nearM = null, nearName = null;
    if (x.key && !String(x.key).startsWith('place:')) {
      const o = oMap.get(x.key); if (o) { lat = o.lat; lon = o.lon; nearM = o.nearest_point_m; nearName = o.nearest_point_name; }
    } else if (x.key) {
      const p = pMap.get(Number(String(x.key).slice(6))); if (p) { lat = p.lat; lon = p.lon; }
    }
    if (lat == null && x.coords) [lat, lon] = parseCoords(x.coords);
    x.lat = lat; x.lon = lon; x.nearM = nearM; x.nearName = nearName;
  }
  return rows;
}

function auditSheet(cfg, rows, bazaKeys) {
  // индексы для дублей: имя, полный адрес, и «имя+адрес» (настоящий дубль)
  const byName = new Map(), byFull = new Map(), byBoth = new Map();
  for (const x of rows) {
    x.nk = nameKey(x.name); x.ap = addrParts(x.addr);
    if (x.nk) byName.set(x.nk, (byName.get(x.nk) || 0) + 1);
    if (x.ap.full.replace(/[|,]/g, '').trim().length > 1) byFull.set(x.ap.full, (byFull.get(x.ap.full) || 0) + 1);
    if (x.nk && x.ap.house) { const b = x.nk + '#' + x.ap.full; byBoth.set(b, (byBoth.get(b) || 0) + 1); }
  }
  const coordPts = rows.filter((x) => x.lat != null);
  for (const x of rows) {
    const f = [];
    const isPlace = x.key && String(x.key).startsWith('place:');
    const nm = String(x.name || '').trim();
    if (!nm || /без названия/i.test(nm)) f.push('БЕЗ_НАЗВАНИЯ');
    if (!String(x.addr || '').trim()) f.push('НЕТ_АДРЕСА');
    if (x.lat == null && !cfg.ref) f.push('НЕТ_КООРДИНАТ');
    if (isPlace && !cfg.chain) f.push('НЕ_ЗДАНИЕ');
    // настоящий дубль — совпали и имя, и полный адрес (то же здание, та же строка)
    if (x.nk && x.ap.house && byBoth.get(x.nk + '#' + x.ap.full) > 1) f.push('ДУБЛЬ');
    // одиночные (слабые) сигналы — только если не сеть и не сработал строгий ДУБЛЬ
    else if (!cfg.chain) {
      if (x.nk && byName.get(x.nk) > 1) f.push('ДУБЛЬ_ИМЕНИ?');
      if (x.ap.full.replace(/[|,]/g, '').trim().length > 1 && byFull.get(x.ap.full) > 1) f.push('ДУБЛЬ_АДРЕСА');
    } else if (x.ap.full.replace(/[|,]/g, '').trim().length > 1 && byFull.get(x.ap.full) > 1) f.push('ДУБЛЬ_АДРЕСА');
    // координатный дубль (в пределах 20 м другой ключ) — арендатор внутри здания / задвоение
    if (x.lat != null) {
      for (const y of coordPts) {
        if (y === x || y.key === x.key) continue;
        if (Math.abs(y.lat - x.lat) < 0.0005 && distM(x.lat, x.lon, y.lat, y.lon) < 20) { f.push('ДУБЛЬ_КООРДИНАТ'); break; }
      }
    }
    if (cfg.minArea && x.area != null && Number(x.area) > 0 && Number(x.area) < cfg.minArea) f.push(`ПЛОЩАДЬ<${cfg.minArea / 1000}К`);
    if (x.floors != null && Number(x.floors) > 100) f.push('ЭТАЖНОСТЬ?');
    if (x.nearM != null && x.nearM <= 40) f.push('В_ТОЧКАХ_МИЛТИ');
    // кросс-сверка с Базой: полный адрес совпал ИЛИ сильное имя при известном доме
    if (cfg.xBaza && bazaKeys && ((x.ap.full && x.ap.house && bazaKeys.full.has(x.ap.full)) || (x.nk && x.nk.length >= 6 && bazaKeys.names.has(x.nk)))) f.push('ЕСТЬ_В_БАЗЕ');
    x.flags = f;
  }
  return rows;
}

// --- Nominatim reverse (fallback без ключа) ---------------------------------
async function reverse(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=ru`;
  const res = await fetch(url, { headers: { 'User-Agent': 'kosmos-audit/1.0 (milti)' } });
  if (!res.ok) throw new Error('nominatim ' + res.status);
  const j = await res.json();
  const a = j.address || {};
  return { address: j.display_name || '', road: a.road || '', house: (a.house_number || '').toLowerCase() };
}

// Yandex forward geocode вынесен в ../src/lib/yandex.js — там жёсткий дневной
// лимит (900/сут) и кэш. Здесь используем импорт yandexGeo().

export async function auditAll(r, { geo = 0 } = {}) {
  // ключи Базы для кросс-сверки «На проверку»
  const bz = await r.sql`SELECT "Название" AS name, "Адрес" AS addr FROM vitrina."База"`;
  const bazaKeys = { names: new Set(), full: new Set() };
  for (const b of bz) { const nk = nameKey(b.name); if (nk) bazaKeys.names.add(nk); const ap = addrParts(b.addr); if (ap.house) bazaKeys.full.add(ap.full); }

  const all = {};
  const geoQueue = [];
  for (const cfg of SHEETS) {
    const rows = await readSheet(r, cfg);
    auditSheet(cfg, rows, bazaKeys);
    all[cfg.v] = rows;
    // копим кандидатов на гео-сверку: координата+адрес+имя (безымянные бесполезны
    // для проверки адреса). Приоритет — крупные здания (их справочник точно знает).
    for (const x of rows) {
      const named = x.name && !/без названия/i.test(x.name);
      if (x.lat != null && String(x.addr || '').trim() && named && !cfg.ref) geoQueue.push({ cfg: cfg.v, x, pri: Number(x.area) || 0 });
    }
  }

  // отчёт «Итоги»
  console.log('════════ АУДИТ ВСЕХ ЛИСТОВ ════════');
  for (const cfg of SHEETS) {
    const rows = all[cfg.v];
    const flagCount = {};
    let clean = 0;
    for (const x of rows) { if (!x.flags.length) clean++; for (const fl of x.flags) flagCount[fl] = (flagCount[fl] || 0) + 1; }
    console.log(`\n### ${cfg.v} — ${rows.length} строк | чистых ${clean} (${Math.round(clean / rows.length * 100)}%)`);
    for (const [k, n] of Object.entries(flagCount).sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
  }

  // гео-сверка
  if (geo > 0) {
    geoQueue.sort((a, b) => b.pri - a.pri);
    const pick = geoQueue.slice(0, geo);
    const YKEY = process.env.YANDEX_GEOCODER_KEY;
    const mode = YKEY ? `Yandex forward (лимит ${DAILY_CAP}/сут, сегодня использовано ${budgetUsed()}, осталось ${budgetLeft()})` : 'Nominatim reverse';
    console.log(`\n════════ ГЕО-СВЕРКА (${mode}, ${pick.length} строк) ════════`);
    if (YKEY && budgetLeft() <= 0) { console.log('  суточный лимit Яндекса исчерпан — гео-сверка пропущена'); }
    let mism = 0, notfound = 0;
    for (let i = 0; i < pick.length; i++) {
      const { cfg, x } = pick[i];
      try {
        if (YKEY) {
          // forward: где справочник видит объект с таким названием (кэш+лимит внутри)
          const hit = await yandexGeo(`Москва, ${x.name}`);
          // precision 'other' = справочник не нашёл объект, вернул центр города/района —
          // сравнивать координату с таким нельзя (даст ложное «не сошлось»)
          if (!hit || hit.precision === 'other') { notfound++; }
          else {
            const d = distM(x.lat, x.lon, hit.lat, hit.lon);
            x.geo = hit.address;
            // расстояние сравниваем только при точной привязке (дом/подъезд); при
            // 'street'/'range' координата справочника — центр улицы, далёкое d ложно
            const precise = ['exact', 'number', 'near'].includes(hit.precision);
            const bb = baseHouse(x.addr), hb = baseHouse(hit.address);
            const houseDiff = bb && hb && bb.d !== hb.d ? ` дом ${bb.d}${bb.l}≠${hb.d}${hb.l}` : '';
            if (precise && d >= 1500) {
              mism++; x.flags.push('НЕ_СОШЛОСЬ');
              x.geoNote = `имя ведёт в другое место (${(d / 1000).toFixed(1)} км): ${hit.address}`;
              console.log(`  [НЕ СОШЛОСЬ ${(d / 1000).toFixed(1)}км] [${cfg}] ${String(x.name).slice(0, 38)} | база «${x.addr}» ↔ Я «${hit.address}»`);
            } else if ((precise && d >= 300) || houseDiff) {
              mism++; x.flags.push('РАЗНОЧТЕНИЕ_ГЕО');
              x.geoNote = `расхождение ${precise ? Math.round(d) + ' м' : ''}${houseDiff}: ${hit.address}`;
              console.log(`  [РАЗН ${precise ? Math.round(d) + 'м' : ''}${houseDiff}] [${cfg}] ${String(x.name).slice(0, 38)} | «${x.addr}» ↔ Я «${hit.address}»`);
            }
          }
          await new Promise((s) => setTimeout(s, 200));
        } else {
          const hit = await reverse(x.lat, x.lon);
          x.geo = `${hit.road} ${hit.house}`.trim();
          const bb = baseHouse(x.addr), hb = hitHouse(hit.house);
          if (bb && hb && bb.d !== hb.d) {
            mism++; x.flags.push('РАЗНОЧТЕНИЕ_ДОМА');
            x.geoNote = `дом: база ${bb.d}${bb.l}, справочник ${hb.d}${hb.l} (${x.geo})`;
            console.log(`  [${cfg}] ${String(x.name || '—').slice(0, 40)} | «${x.addr}» ↔ «${x.geo}» (${bb.d}≠${hb.d})`);
          }
          await new Promise((s) => setTimeout(s, 1100));
        }
      } catch (e) {
        if (e.message.startsWith('YANDEX_BUDGET')) { console.log(`  ⛔ ${e.message} — гео-сверка остановлена, лимит бережём`); break; }
        if (/\b40[13]\b/.test(e.message)) { console.log(`  ✗ ключ Яндекса отклонён (${e.message}) — стоп`); break; }
      }
      if ((i + 1) % 50 === 0) console.log(`   …${i + 1}/${pick.length}`);
    }
    console.log(`\nнаходок гео: ${mism}${notfound ? `, не найдено справочником: ${notfound}` : ''} из ${pick.length}`);
    if (YKEY) console.log(`Яндекс сегодня: использовано ${budgetUsed()}/${DAILY_CAP}, осталось ${budgetLeft()}`);
  }
  return all;
}

if (isMain(import.meta.url)) {
  const gi = process.argv.indexOf('--geo');
  const geo = gi >= 0 ? Number(process.argv[gi + 1] || 200) : 0;
  const ji = process.argv.indexOf('--json');
  const r = new Registry(loadConfig());
  try {
    const all = await auditAll(r, { geo });
    if (ji >= 0) {
      const { writeFileSync } = await import('node:fs');
      const out = {};
      for (const [sheet, rows] of Object.entries(all)) {
        out[sheet] = rows.map((x) => ({
          name: x.name || '', addr: x.addr || '', area: x.area ?? '', floors: x.floors ?? '',
          key: x.key || '', lat: x.lat ?? '', lon: x.lon ?? '', flags: x.flags.join(', '),
          geo: x.geo || '', geoNote: x.geoNote || '',
        }));
      }
      writeFileSync(process.argv[ji + 1] || 'audit.json', JSON.stringify(out), 'utf8');
      console.log('\nJSON записан.');
    }
  } finally { await r.close(); }
}
