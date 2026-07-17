/**
 * Конфигурация КОСМОСа. Единственное место, где читается окружение.
 */

// Referer обязателен: WAF геопортала НСПД отдаёт 403 без него.
// Проверено разведкой: значения "https://nspd.gov.ru/map" и "https://nspd.gov.ru/"
// заблокированы СПЕЦИАЛЬНО — ими подписываются наивные скраперы.
// Это значение проходит.
export const DEFAULT_NSPD_REFERER = 'https://nspd.gov.ru/map?thematic=PKK';

// mos.ru отдаёт 403 без браузерного User-Agent. Проверено.
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function loadConfig(env = process.env) {
  const dbUrl = env.KOSMOS_DB_URL;
  if (!dbUrl) {
    throw new Error(
      'KOSMOS_DB_URL не задан. Пример: postgresql://user:pass@host:5432/kosmos'
    );
  }
  return {
    dbUrl,
    // Облачный Postgres (Supabase) требует TLS. Без него соединение
    // отвергается с ошибкой «password authentication failed» — она врёт
    // про причину. Для локального Postgres без TLS: KOSMOS_DB_SSL=off.
    dbSsl: env.KOSMOS_DB_SSL === 'off' ? false : 'require',
    // Supabase pooler держит ограниченный пул; 5 достаточно и не упирается в лимит.
    dbMaxConnections: Number(env.KOSMOS_DB_MAX || 5),
    nspdReferer: env.KOSMOS_NSPD_REFERER || DEFAULT_NSPD_REFERER,
    // Путь к bundle с корневым сертификатом Минцифры.
    // Без него Node не доверяет сертификату НСПД: SEC_E_UNTRUSTED_ROOT.
    // Отключать проверку сертификата ЗАПРЕЩЕНО — это не решение, а дыра.
    caBundle: env.KOSMOS_CA_BUNDLE || null,
    nspdRateLimitPerSec: Number(env.KOSMOS_NSPD_RPS || 1),
  };
}
