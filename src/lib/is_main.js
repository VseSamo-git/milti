import { pathToFileURL } from 'node:url';

/**
 * Запущен ли модуль напрямую (node script.js), а не импортирован.
 *
 * Нужно, чтобы скрипты-стадии можно было и запускать из терминала, и
 * импортировать в конвейере, не выполняя их top-level дважды. Сравнение
 * через pathToFileURL корректно на Windows (иначе C:\ ломает сравнение URL).
 *
 * @param {string} metaUrl — import.meta.url вызывающего модуля
 */
export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(entry).href;
}
