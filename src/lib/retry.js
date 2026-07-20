/**
 * Повтор при временном сетевом сбое.
 *
 * Зачем. Обогащение — прогон на 40 часов. За это время облачная база
 * (Supabase) хоть раз, да оборвёт соединение: ECONNRESET на записи.
 * Проверено на живых данных — прогон умер на объекте 1461 из 22 863,
 * потеряв часы, потому что запись в базу не была защищена. Один блип
 * не должен убивать сутки работы.
 *
 * Лечим повтором ТОЛЬКО сетевое: обрыв соединения через полсекунды
 * обычно проходит. Логическую ошибку (нарушен CHECK, дубль ключа)
 * повтором не лечат — она повторится точно так же, поэтому падаем сразу
 * и громко, а не молотим впустую.
 */

const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Коды и подстроки, означающие «сеть моргнула, попробуй ещё».
const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND']);
const TRANSIENT_TEXT = [
  'fetch failed',
  'connection terminated',
  'connection closed',
  'socket hang up',
  'timeout',
];

/**
 * Похоже ли это на временный сетевой сбой, который лечится повтором.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isTransient(error) {
  if (!error) return false;
  if (error.code && TRANSIENT_CODES.has(error.code)) return true;
  const message = String(error.message || '').toLowerCase();
  return TRANSIENT_TEXT.some((needle) => message.includes(needle));
}

/**
 * Выполнить fn с повтором при временной ошибке.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{attempts?: number, backoffMs?: number, sleep?: (ms:number)=>Promise<void>}} opts
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { attempts = 4, backoffMs = 500, sleep = sleepReal } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      // Не сетевое — повтор не поможет. Падаем сразу, без задержек.
      if (!isTransient(error)) throw error;
      // Последняя попытка исчерпана — отдаём ошибку наверх.
      if (attempt >= attempts) break;
      // Линейная задержка: 0.5с, 1с, 1.5с — облачной базе хватает очнуться.
      await sleep(backoffMs * attempt);
    }
  }
  throw lastError;
}
