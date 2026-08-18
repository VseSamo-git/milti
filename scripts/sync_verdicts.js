/**
 * Обратный синк: решения Димы из NocoDB → вердикты в Postgres.
 *
 * NocoDB — односторонняя копия (Postgres → NocoDB), правки в ней сами назад
 * не текут. Но лист «На проверку» даёт Диме колонку-плашку «Решение (ОК / Хуй)»,
 * и его выбор нужно занести в базу, иначе он потеряется при следующей пересборке.
 *
 * Этот скрипт читает плашку и пишет append-only вердикт (тот же механизм, что
 * у бота): ОК → «интересно» (объект уедет в Базу), Хуй → «отказ» (исчезнет).
 * Дедуп: если последний вердикт уже такой же — не дублируем. Read-side (какие
 * строки уйдут/придут) считает SQL-вью, здесь только фиксируем решение.
 *
 * Запуск: node run.js ./scripts/sync_verdicts.js [--apply]
 */
import { loadConfig } from '../src/config.js';
import { isMain } from '../src/lib/is_main.js';
import { NocodbClient } from '../src/lib/nocodb.js';
import { Registry } from '../src/lib/registry.js';
import { recordVerdict } from '../src/bot/tools.js';

// Листы с колонкой решения. Дима просил ОК/Хуй В КАЖДОМ листе, а не только в
// очереди: решение он выносит там, где смотрит. Колонка одна и та же везде.
//   Хуй → 'отказ'      — строка исчезает отовсюду;
//   ОК  → 'интересно'  — во внешних/очередных листах объект уезжает в «Базу»
//                        (с проверкой на дубль по названию+адресу), в самой
//                        «Базе» это просто отметка «проверено, оставить».
const DECISION_SHEETS = [
  { sheet: 'База',               keyCol: 'Ключ', decisionCol: 'Решение (ОК / Хуй)' },
  { sheet: 'На проверку',        keyCol: 'Ключ', decisionCol: 'Решение (ОК / Хуй)' },
  { sheet: 'ТЦ с супермаркетом', keyCol: 'Ключ', decisionCol: 'Решение (ОК / Хуй)' },
  { sheet: 'Конкуренты',         keyCol: 'Ключ', decisionCol: 'Решение (ОК / Хуй)' },
];
const MAP = { 'ОК': 'интересно', 'Хуй': 'отказ' };
const AUTHOR = 'дима (NocoDB)';

export async function syncVerdicts(cfg, { apply = false } = {}) {
  const client = new NocodbClient(cfg);
  const registry = new Registry(cfg);
  try {
    const tables = await client.tables();
    const picks = [];
    const broken = [];
    for (const s of DECISION_SHEETS) {
      const tableId = tables.get(s.sheet);
      if (!tableId) { console.log(`лист «${s.sheet}» не найден в NocoDB — пропуск`); continue; }
      // Каждый лист читается сам по себе. Раньше исключение на одном листе
      // выбрасывало из всего цикла, и решения по ОСТАЛЬНЫМ листам не
      // записывались вообще. Так и вышло: очередь «На проверку» доросла до
      // ровных 500 строк, чтение падало на пагинации — и 499 решений Димы
      // лежали в NocoDB, пока это не заметили. Один сломанный лист не имеет
      // права уносить остальные.
      try {
        const rows = await client.records(tableId, { fields: [s.keyCol, s.decisionCol] });
        for (const r of rows) {
          const dec = r[s.decisionCol];
          const key = r[s.keyCol];
          if (!dec || !key) continue;
          const verdict = MAP[String(dec).trim()];
          if (!verdict) { console.log(`  ? неизвестное решение «${dec}» у ${key}`); continue; }
          picks.push({ key: String(key).trim(), decision: String(dec).trim(), verdict });
        }
      } catch (e) {
        console.log(`  ✗ лист «${s.sheet}» не прочитан: ${e.message}`);
        broken.push({ sheet: s.sheet, error: e.message });
      }
    }
    console.log(`решений в NocoDB: ${picks.length}`);
    // Инвариант «частичный сбой не молчит»: сводка отдельной строкой, чтобы
    // это было видно в логе без раскопок, и наверх — кодом возврата.
    if (broken.length) {
      console.log(`⚠ НЕ ПРОЧИТАНО ЛИСТОВ: ${broken.length} — ${broken.map((b) => b.sheet).join(', ')}`);
      console.log('  решения из них не записаны; остальные листы обработаны');
    }
    if (!picks.length) return { picks: 0, applied: 0, broken };

    // Дедуп по последнему вердикту: плашка стоит до пересборки, без этого
    // каждый прогон плодил бы одинаковые вердикты.
    const keys = [...new Set(picks.map((p) => p.key))];
    const last = await registry.sql`
      SELECT entity_key, verdict FROM vitrina._last_verdict
      WHERE entity_key = ANY(${keys})`;
    const lastByKey = new Map(last.map((r) => [r.entity_key, r.verdict]));

    const todo = picks.filter((p) => lastByKey.get(p.key) !== p.verdict);
    console.log(`к записи (новые/изменённые): ${todo.length}`);
    for (const p of todo) console.log(`  ${p.decision} → ${p.verdict}  [${p.key}]`);

    if (!apply) { console.log('\n(dry-run: --apply чтобы записать вердикты)'); return { picks: picks.length, pending: todo.length, broken }; }

    let ok = 0, fail = 0;
    for (const p of todo) {
      try {
        await recordVerdict(registry, {
          key: p.key, verdict: p.verdict,
          note: `решение с десктопа NocoDB (${p.decision})`, author: AUTHOR,
        });
        ok++;
      } catch (e) { console.log(`  ✗ ${p.key}: ${e.message}`); fail++; }
    }
    console.log(`\nзаписано вердиктов: ${ok}${fail ? `, ошибок: ${fail}` : ''}`);
    return { picks: picks.length, applied: ok, failed: fail, broken };
  } finally {
    await registry.close();
  }
}

if (isMain(import.meta.url)) {
  const apply = process.argv.includes('--apply');
  const result = await syncVerdicts(loadConfig(), { apply });
  // Непрочитанный лист — это молча потерянные решения Димы. Код возврата
  // делает сбой видимым крону и человеку, читающему лог хвостом.
  if (result.broken?.length) process.exitCode = 1;
}
