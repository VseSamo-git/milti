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
import { buildVitrina } from './build_vitrina.js';

export async function refreshDesktop(cfg, { mode = 'quick' } = {}) {
  console.log('===== синк решений NocoDB → вердикты =====');
  const r = await syncVerdicts(cfg, { apply: true });

  // quick: пересобираем «На проверку» ТОЛЬКО когда реально были решения —
  // иначе таблица дропалась бы каждые полчаса и «моргала» у Димы без причины.
  // full: пересобираем всегда (суточная сверка, ОК-объекты появляются в Базе).
  if (mode === 'full') {
    console.log('\n===== пересборка витрины (все листы) =====');
    await buildVitrina(cfg);
  } else if (r.applied > 0) {
    console.log(`\n===== есть ${r.applied} решений → пересборка «На проверку» =====`);
    await buildVitrina(cfg, { only: 'На проверку' });
  } else {
    console.log('\nновых решений нет — пересборку пропускаем');
  }
  return r;
}

if (isMain(import.meta.url)) {
  const mode = process.argv[2] === 'full' ? 'full' : 'quick';
  await refreshDesktop(loadConfig(), { mode });
}
