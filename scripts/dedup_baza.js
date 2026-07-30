/**
 * Дедуп «Базы» по названию + адресу (требование Димы).
 *
 * ЗАЧЕМ. Один комплекс приезжает несколькими строками: дробление кадастра
 * (корпус/строение), внешний каталог поверх реестра, OSM-место поверх здания.
 * Дима просил: при переносе строки в Базу по решению ОК — проверять на дубль
 * по названию и адресу. Проверка нужна не только в момент переноса: те же
 * дубли уже лежат в Базе с прошлых заливок.
 *
 * КАК. Ключ дубля = нормализованное название + нормализованный адрес
 * (src/lib/addr_key.js). Совпали ОБА — это одна и та же строка у одного дома.
 * Одного названия мало («Синергия» в пяти зданиях), одного адреса тоже мало
 * (Королёва 13: «Роснефть» и «БЦ Мосавто» — разные здания одного адреса).
 *
 * КОГО ОСТАВЛЯЕМ В ГРУППЕ. Приоритет — у строки с максимумом проверяемых
 * данных, а не у случайной:
 *   1. реестр 700-ПП важнее внешнего каталога (у него кадастр и площадь ФНС);
 *   2. при равенстве — большая площадь (главный корпус комплекса);
 *   3. при равенстве — меньший ключ, чтобы прогон был детерминирован.
 * Проигравшие получают status='дубль_в_базе' — они исчезают из витрины,
 * но остаются в БД: решение обратимо.
 *
 * Запуск:  node run.js ./scripts/dedup_baza.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import { Registry } from '../src/lib/registry.js';
import { isMain } from '../src/lib/is_main.js';
import { dupKey } from '../src/lib/addr_key.js';

/** Победитель группы: реестр > внешний, затем большая площадь, затем ключ. */
export function pickWinner(rows) {
  return [...rows].sort((a, b) =>
    (a.external ? 1 : 0) - (b.external ? 1 : 0) ||
    (b.area ?? -1) - (a.area ?? -1) ||
    String(a.key).localeCompare(String(b.key))
  )[0];
}

/** Разложить строки Базы по ключу «название+адрес». Без ключа — не дубль. */
export function groupDuplicates(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const k = dupKey(r.name, r.address);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  return [...byKey.entries()].filter(([, rs]) => rs.length > 1);
}

export async function dedupBaza(registry, { apply = false } = {}) {
  const rows = await registry.sql`
    SELECT "Ключ" AS key, "Название" AS name, "Адрес" AS address,
           "Площадь, м²" AS area, "Источник" AS source, "Тип объекта" AS type
      FROM vitrina."База"`;
  const groups = groupDuplicates(rows.map((r) => ({
    ...r, external: r.source !== 'реестр 700-ПП' && r.source !== 'OSM',
  })));

  const losers = [];
  for (const [k, rs] of groups) {
    const win = pickWinner(rs);
    for (const r of rs) if (r.key !== win.key) losers.push({ ...r, dup_of: win.key, k });
  }

  console.log(`строк в Базе: ${rows.length}`);
  console.log(`групп дублей (название+адрес): ${groups.length}, лишних строк: ${losers.length}`);
  for (const l of losers.slice(0, 25)) {
    console.log(`  ${l.type} · ${l.name} · ${l.address}  [${l.key}] → дубль ${l.dup_of}`);
  }
  if (losers.length > 25) console.log(`  … ещё ${losers.length - 25}`);

  if (!apply) { console.log('\n(dry-run: --apply чтобы пометить дубли)'); return { groups: groups.length, losers: losers.length }; }

  const cads = losers.filter((l) => !String(l.key).startsWith('place:')).map((l) => l.key);
  const pids = losers.filter((l) => String(l.key).startsWith('place:')).map((l) => Number(String(l.key).slice(6)));
  if (cads.length) await registry.sql`
    UPDATE kosmos.objects SET status='дубль_в_базе' WHERE cadastral_no = ANY(${cads})`;
  if (pids.length) await registry.sql`
    UPDATE kosmos.places SET status='дубль_в_базе' WHERE id = ANY(${pids})`;
  console.log(`\nпомечено дублями: здания ${cads.length}, места ${pids.length}`);
  return { groups: groups.length, losers: losers.length, applied: true };
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const registry = new Registry(loadConfig());
  try { await dedupBaza(registry, { apply }); }
  finally { await registry.close(); }
}
