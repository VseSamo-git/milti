/**
 * Тонкий HTTP-хелпер для store-locator'ов сетей.
 *
 * Сайты капризны, и капризы проверены разведкой на живых данных 2026-07-20:
 *   - многие отдают 403 без браузерного User-Agent;
 *   - bodro.coffee отдаёт 403 без Referer на свою же страницу;
 *   - karavaevi.ru делает 301 без слэша в конце пути — нужен redirect: follow.
 *
 * Ретраи: сайт может моргнуть. Три попытки с паузой, как у клиента Overpass.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET/POST с ретраями. Возвращает текст тела.
 * @param {string} url
 * @param {{method?, headers?, body?, attempts?, backoffMs?}} opts
 */
export async function httpText(url, { method = 'GET', headers = {}, body, attempts = 3, backoffMs = 3000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': UA, ...headers },
        body,
        redirect: 'follow',
      });
      if (!res.ok) {
        lastError = new Error(`${url}: HTTP ${res.status}`);
      } else {
        return await res.text();
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await sleep(backoffMs * attempt);
  }
  throw lastError || new Error(`${url}: недоступен`);
}

/** GET c разбором JSON. */
export async function httpJson(url, opts = {}) {
  return JSON.parse(await httpText(url, opts));
}
