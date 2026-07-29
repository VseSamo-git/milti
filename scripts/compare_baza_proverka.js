/**
 * Сверка «На проверку» с «Базой» по адресу (и координатам).
 *
 * Одно здание может дать несколько кадастровых объектов (дробление комплекса)
 * или попасть и в реестр, и во внешний каталог. Тогда часть строк «На проверку»
 * — это тот же адрес, что уже стоит лидом в «Базе». Их проверять не нужно.
 *
 * Матч: нормализованный адрес (улица+дом) ИЛИ координаты ≤50 м.
 * Только чтение — считаем и показываем, ничего не меняем.
 * Запуск: node run.js ./scripts/compare_baza_proverka.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import postgres from 'postgres';

const apply = process.argv.includes('--apply');
const cfg = loadConfig();
const sql = postgres(cfg.dbUrl, { ssl: cfg.dbSsl, max: 1 });

function addrKey(s) {
  if (!s) return null;
  let t = ` ${s.toLowerCase().replace(/ё/g, 'е')} `;
  t = t.replace(/\b(российская федерация|г\.?|город|москва|московская|обл\.?|область|мо|поселение|деревня|д\.|рп|пгт|вн\.?тер\.?г\.?|муниципальный округ|район|р-н|ао|зао|сао|свао|юао|юзао|сзао|ювао|цао|нао|тао)\b/g, ' ');
  t = t.replace(/\b(улица|ул|проспект|пр-кт|пр-т|проезд|переулок|пер|шоссе|ш|бульвар|б-р|бул|набережная|наб|площадь|пл|аллея|линия|тупик|квартал|кв-л)\b\.?/g, ' ');
  t = t.replace(/\b(дом|корпус|корп|кор|строение|стр|владение|вл|литера|лит)\b\.?/g, ' ');
  t = t.replace(/[^0-9a-zа-я]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter((w) => /[а-яa-z]/.test(w) && w.length > 2);
  const nums = t.split(' ').filter((w) => /\d/.test(w));
  if (!words.length || !nums.length) return null;
  return words.sort().join(' ') + '|' + nums.sort().join(' ');
}
const R = 6371000, rad = (d) => d * Math.PI / 180;
const distM = (a, b, c, d) => { const dLa = rad(c - a), dLo = rad(d - b); const s = Math.sin(dLa / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

// Предикаты множеств повторяют вьюхи Базы (часть A) и «На проверку».
const RETAIL = `(o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|молл|аутлет|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)')`;
const BAZA = `o.status NOT LIKE 'вычтен%' AND (v.verdict IS NULL OR v.verdict<>'отказ') AND (
  (o.origin IS NULL AND (
    ((o.object_type='бц' OR o.arendator_matched) AND (o.arendator_matched OR o.area_sqm>=10000 OR o.area_sqm IS NULL))
    OR o.object_type IN ('офисное_здание','офис_компании')
    OR (o.object_type='неизвестен' AND NOT coalesce(o.arendator_matched,false) AND o.annex=1 AND o.area_sqm>=10000 AND o.floors>0 AND o.area_sqm/o.floors<=3000 AND ${RETAIL})
  )) OR (o.origin IS NOT NULL AND v.verdict='интересно'))`;
const PROV = `o.status NOT LIKE 'вычтен%' AND v.verdict IS NULL AND (
  o.origin IS NOT NULL
  OR (o.origin IS NULL AND o.object_type='неизвестен' AND o.annex=1 AND o.area_sqm>=10000
      AND (o.floors IS NULL OR o.floors=0 OR o.area_sqm/o.floors>3000) AND ${RETAIL}))`;

try {
  const baza = await sql.unsafe(`SELECT o.cadastral_no, o.title, o.address, o.lat, o.lon FROM kosmos.objects o LEFT JOIN vitrina._last_verdict v ON v.object_id=o.id WHERE ${BAZA}`);
  const prov = await sql.unsafe(`SELECT o.cadastral_no, o.title, o.address, o.lat, o.lon, o.origin, round(o.area_sqm)::int area FROM kosmos.objects o LEFT JOIN vitrina._last_verdict v ON v.object_id=o.id WHERE ${PROV}`);
  const extN = prov.filter((p) => p.origin).length;
  console.log(`База (объекты-здания): ${baza.length} | На проверку: ${prov.length} (внешних ${extN}, реестр ${prov.length - extN})`);

  // Индекс Базы по нормализованному адресу → объект (для показа, с чем совпало).
  const bazaByKey = new Map();
  for (const o of baza) { const k = addrKey(o.address); if (k && !bazaByKey.has(k)) bazaByKey.set(k, o); }
  const matched = [];
  for (const p of prov) {
    const k = addrKey(p.address);
    let hit = null, b = null;
    if (k && bazaByKey.has(k)) { hit = 'адрес'; b = bazaByKey.get(k); }
    if (!hit && p.lat != null) for (const o of baza) { if (o.lat != null && distM(p.lat, p.lon, o.lat, o.lon) <= 50) { hit = 'коорд'; b = o; break; } }
    if (hit) matched.push({ p, hit, b });
  }
  const mExt = matched.filter((m) => m.p.origin);
  const mReg = matched.filter((m) => !m.p.origin);
  console.log(`\n=== СОВПАЛИ с адресом/координатой Базы: ${matched.length} ===`);
  console.log(`   внешние БЦ: ${mExt.length} из ${extN} | реестр-неясные: ${mReg.length} из ${prov.length - extN}`);
  console.log(`   (эти здания уже есть лидом в Базе → из «На проверку» можно убрать)`);
  console.log(`\n--- внешние БЦ, совпавшие с Базой (${mExt.length}) ---`);
  for (const m of mExt.slice(0, 40)) console.log(`  [${m.hit}] ${m.p.origin} «${m.p.title || '—'}» ${m.p.area||'?'}м²\n        ≈ Базе «${m.b.title || '—'}» | ${m.p.address}`);
  console.log(`\n--- реестр-неясные, совпавшие с Базой (первые 20 из ${mReg.length}) ---`);
  for (const m of mReg.slice(0, 20)) console.log(`  [${m.hit}] ${m.p.area||'?'}м² «${m.p.title||'—'}» | ${m.p.address}`);

  if (apply && matched.length) {
    const cads = matched.map((m) => m.p.cadastral_no);
    const del = await sql`UPDATE kosmos.objects SET status='дубль_в_базе', subtract_reason='адрес уже есть лидом в Базе'
      WHERE cadastral_no = ANY(${cads}) AND status='активен' RETURNING cadastral_no`;
    console.log(`\nпомечено дублями (ушли из «На проверку»): ${del.length}`);
  } else if (matched.length) {
    console.log('\n(dry-run: --apply чтобы пометить их дублями и убрать из «На проверку»)');
  }
} finally { await sql.end({ timeout: 5 }); }
