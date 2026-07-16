/**
 * Скачать адресный реестр Москвы и построить карту UNOM.
 *
 * ~549 запросов к data.mos.ru, единицы минут. Разовая операция.
 * Результат: data/unom_map.json — {кадастровый номер: UNOM}.
 *
 * Запуск: node scripts/fetch_unom_map.js
 */
import {
  ATTRIBUTION,
  buildUnomMapFromApi,
  saveUnomMap,
} from '../src/sources/addr_registry.js';

const DEST = 'data/unom_map.json';

const startedAt = Date.now();
let lastReport = 0;

const { map, seen, catalogId } = await buildUnomMapFromApi({
  onProgress(processed, total, mapped) {
    if (processed - lastReport < 50_000) return;
    lastReport = processed;
    const pct = total ? ((100 * processed) / total).toFixed(0) : '?';
    console.log(`  ${processed}/${total} (${pct}%) — в карте ${mapped}`);
  },
});

const { count } = await saveUnomMap(map, DEST);
const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);

console.log('');
console.log('=== ГОТОВО ===');
console.log('catalogId       :', catalogId);
console.log('строк обработано:', seen);
console.log('пар в карте     :', count);
console.log('время           :', seconds, 'сек');
console.log('файл            :', DEST);
console.log('');
console.log(ATTRIBUTION);
