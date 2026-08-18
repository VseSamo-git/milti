/**
 * Живое обновление витрины под десктоп-работу Димы: подхватить его решения
 * ОК/Хуй из NocoDB и пересобрать листы, чтобы строки реально уехали.
 *
 * ПОРЯДОК ВАЖЕН: сначала синк (зафиксировать выбор в вердиктах), потом
 * пересборка (которая дропает таблицу). Иначе пересборка сотрёт плашку
 * раньше, чем решение попало в базу.
 *
 * Режимы:
 *   quick (по умолчанию) — синк + пересборка только «На проверку». Дёшево,
 *          строка-решение уходит из очереди. Для частого cron (каждые 30 мин).
 *   full  — синк + пересборка всех листов: ОК-объект появляется и в «Базе».
 *          Для суточного cron (тяжелее: «База» ~2 тыс строк).
 *
 * Запуск: node run.js ./scripts/refresh_desktop.js [quick|full]
 */
import { loadConfig } from '../src/config.js';
import { isMain } from '../src/lib/is_main.js';
import { syncVerdicts } from './sync_verdicts.js';
import { reconcile } from './reconcile_proverka.js';
import { buildVitrina } from './build_vitrina.js';

export async function refreshDesktop(cfg, { mode = 'quick' } = {}) {
  console.log('===== синк решений NocoDB → вердикты =====');
  const r = await syncVerdicts(cfg, { apply: true });

  // Пересобираем, только когда что-то изменилось: full (суточная сверка) или
  // были новые решения (База выросла → надо пересчитать дубли/флаги и убрать
  // из очереди то, что уехало). Иначе таблица «моргала» бы каждую минуту зря.
  if (mode === 'full' || r.applied > 0) {
    console.log('\n===== сверка «На проверку» ↔ «База» (дубли + флаги) =====');
    await reconcile(cfg, { apply: true });
    if (mode === 'full') {
      console.log('\n===== пересборка витрины (все листы) =====');
      await buildVitrina(cfg);
    } else {
      console.log(`\n===== есть ${r.applied} решений → пересборка «На проверку» =====`);
      await buildVitrina(cfg, { only: 'На проверку' });
    }
  } else {
    console.log('\nновых решений нет — сверку и пересборку пропускаем');
  }
  if (r.broken?.length) {
    console.log(`
⚠ листы, которые не удалось прочитать: ${r.broken.map((b) => b.sheet).join(', ')}`);
  }
  return r;
}

if (isMain(import.meta.url)) {
  const mode = process.argv[2] === 'full' ? 'full' : 'quick';
  const result = await refreshDesktop(loadConfig(), { mode });
  if (result.broken?.length) process.exitCode = 1;
}
