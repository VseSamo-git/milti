/**
 * Применение находок аудита к боевой базе (точечно, обратимо).
 *
 * Правки — только высокоуверенные факт-ошибки, найденные внешним аудитом
 * (БАЗА_сверка.xlsx, Яндекс-геокодер) и подтверждённые нашим прогоном
 * (scripts/audit_all_sheets.js). Спорное сюда не входит.
 *
 * Каждая правка обратима: дубль — через status='дубль_в_базе' (строка остаётся
 * в БД, исчезает из витрины), поля — с логом «было→стало». Ничего не удаляем.
 *
 * Запуск:  node run.js ./scripts/apply_audit_fixes.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';

// Каждая запись — один кадастр и что с ним делаем.
//  dubl_of  → пометить дублем указанной строки
//  set      → присвоить поля (null допустим — «снять значение»)
const FIXES = [
  {
    key: '77:01:0004042:1018', title: 'Комплекс "Башня на набережной"',
    dubl_of: '77:01:0004042:6314',
    why: 'дубль комплекса «Башня на набережной» (аудит): две строки давали 416 тыс. м² на комплекс ~254 тыс.',
  },
  {
    key: '77:01:0004042:6314', title: 'Башня на Набережной',
    set: { floors: null },
    why: 'этажность 77 невозможна (у комплекса макс 59) — снимаем',
  },
  {
    key: '77:01:0004042:10686', title: 'ОКО-II',
    set: {
      address: 'Российская Федерация, г. Москва, вн.тер.г. муниципальный округ Пресненский, проезд 1-й Красногвардейский, д. 21, стр. 2',
      address_source: 'аудит', floors: null,
    },
    why: 'адрес д.19 неверен — ОКО-II (южная башня) стоит на д.21, стр.2; этажность 19 неверна',
  },
  {
    key: '77:01:0005001:7276', title: 'Смоленский пассаж 2',
    set: {
      address: 'Российская Федерация, город Москва, вн.тер.г. муниципальный округ Арбат, площадь Смоленская, дом 7',
      address_source: 'аудит',
    },
    why: 'номер дома 5→7 (Яндекс и OSM согласны, координата точная)',
  },
];

export async function applyAuditFixes(registry, { apply = false } = {}) {
  const keys = FIXES.map((f) => f.key);
  const cur = await registry.sql`
    SELECT cadastral_no, title, address, floors, status FROM kosmos.objects
    WHERE cadastral_no = ANY(${keys})`;
  const byKey = new Map(cur.map((o) => [o.cadastral_no, o]));

  console.log('═══ ПРАВКИ АУДИТА ═══\n');
  for (const f of FIXES) {
    const o = byKey.get(f.key);
    if (!o) { console.log(`✗ ${f.key} (${f.title}) — не найден в базе, пропуск\n`); continue; }
    console.log(`• ${f.title}  [${f.key}]`);
    console.log(`  причина: ${f.why}`);
    if (f.dubl_of) {
      console.log(`  статус: «${o.status}» → «дубль_в_базе» (дубль ${f.dubl_of})`);
    } else {
      for (const [k, v] of Object.entries(f.set)) {
        const was = o[k] === null || o[k] === undefined ? '∅' : o[k];
        console.log(`  ${k}: «${was}» → «${v === null ? '∅' : v}»`);
      }
    }
    console.log('');
  }

  if (!apply) { console.log('(dry-run: --apply чтобы записать)'); return { fixes: FIXES.length, applied: 0 }; }

  let n = 0;
  for (const f of FIXES) {
    if (!byKey.has(f.key)) continue;
    if (f.dubl_of) {
      await registry.sql`
        UPDATE kosmos.objects
        SET status='дубль_в_базе', subtract_reason=${'дубль (аудит): ' + f.dubl_of}
        WHERE cadastral_no=${f.key}`;
    } else {
      // собираем SET динамически из f.set
      const cols = Object.keys(f.set);
      const assigns = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const vals = cols.map((c) => f.set[c]);
      await registry.sql.unsafe(
        `UPDATE kosmos.objects SET ${assigns} WHERE cadastral_no = $1`,
        [f.key, ...vals],
      );
    }
    n++;
  }
  console.log(`\nприменено правок: ${n}`);
  return { fixes: FIXES.length, applied: n };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const registry = new Registry(loadConfig());
  try { await applyAuditFixes(registry, { apply }); }
  finally { await registry.close(); }
}
