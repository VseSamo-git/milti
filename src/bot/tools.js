/**
 * Инструменты телеграм-агента Димы. Между «Дима написал словами» и базой.
 *
 * ПРИНЦИП БЕЗОПАСНОСТИ. Дима правит боевую базу текстом из чата, а команду
 * переводит LLM — значит LLM НЕЛЬЗЯ давать сырой доступ на запись. Поэтому:
 *
 *   ЧТЕНИЕ  — LLM пишет SELECT, но выполняется он на read-only соединении
 *             и через guard isReadOnlySelect. Даже если модель сгенерирует
 *             DELETE, база его не выполнит (два рубежа: guard + read-only tx).
 *
 *   ЗАПИСЬ  — НЕ сырой SQL. Единственная запись — добавить вердикт к зданию
 *             (kosmos.verdicts — единственная таблица, куда пишет человек,
 *             append-only, ничем не затирается). Снести таблицу, удалить
 *             строки, поменять площадь LLM не может: такого инструмента нет.
 *
 * Это и есть «полное редактирование» в понятной Диме форме (интересно /
 * не наш формат / проверить / отказ + заметка), но без права разрушать.
 */

// Вердикты — ровно те, что заложены в схему (kosmos.verdicts.verdict).
export const VERDICTS = ['интересно', 'не_наш_формат', 'проверить', 'отказ'];

// Разрешённые к чтению вью — то, что Дима видит в NocoDB. Служебные схемы
// (kosmos с сырьём, information_schema, pg_catalog) закрыты.
const READABLE_SCHEMA = 'vitrina';

/**
 * Пропустить запрос ТОЛЬКО если это одиночный безопасный SELECT.
 *
 * Отсекаем всё, что меняет данные или структуру, и всё, что прячет вторую
 * команду за точкой с запятой. Регистронезависимо. Это первый рубеж —
 * второй (read-only транзакция) стоит в queryBase на случай хитрой обёртки.
 *
 * @param {string} sql
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function isReadOnlySelect(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    return { ok: false, reason: 'пустой запрос' };
  }
  const q = sql.trim();

  // Одна команда. Точка с запятой допустима только в самом конце.
  const withoutTrailing = q.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    return { ok: false, reason: 'несколько команд в одном запросе запрещено' };
  }

  // Начинается с SELECT или WITH (CTE, который тоже читает).
  if (!/^\s*(select|with)\b/i.test(withoutTrailing)) {
    return { ok: false, reason: 'разрешён только SELECT' };
  }

  // Явный чёрный список пишущих/структурных операций. Границы слов — чтобы
  // не ловить «created_at» на «create». Комментарии тоже запрещаем: за «--»
  // легко спрятать вторую строку.
  const banned =
    /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|call|do|vacuum|reindex|refresh|comment|set|reset|begin|commit|rollback|savepoint)\b/i;
  const m = withoutTrailing.match(banned);
  if (m) return { ok: false, reason: `запрещённое слово: ${m[1].toLowerCase()}` };

  if (/--|\/\*/.test(withoutTrailing)) {
    return { ok: false, reason: 'комментарии в запросе запрещены' };
  }

  return { ok: true };
}

/**
 * Выполнить читающий запрос Димы. Guard + read-only транзакция.
 *
 * @param {import('../lib/registry.js').Registry} registry
 * @param {string} userSql
 * @param {number} [limit] — жёсткий потолок строк, чтобы не вернуть 40 000
 * @returns {Promise<object[]>}
 */
export async function queryBase(registry, userSql, limit = 50) {
  const guard = isReadOnlySelect(userSql);
  if (!guard.ok) throw new Error(`запрос отклонён: ${guard.reason}`);

  // Второй рубеж: read-only транзакция. Любая запись внутри неё падает,
  // даже если guard кто-то обошёл. search_path сужаем до витрины.
  return registry.sql.begin(async (sql) => {
    await sql`SET TRANSACTION READ ONLY`;
    await sql.unsafe(`SET LOCAL search_path TO ${READABLE_SCHEMA}`);
    const rows = await sql.unsafe(userSql);
    return rows.slice(0, limit);
  });
}

/**
 * Записать вердикт Димы к зданию. Единственная операция записи.
 *
 * Здание ищем по кадастровому номеру (он есть во всех листах-объектах).
 * Ничего не удаляем и не перезаписываем: добавляем строку в append-only
 * kosmos.verdicts, последний вердикт побеждает при показе.
 *
 * @param {import('../lib/registry.js').Registry} registry
 * @param {{cadastralNo: string, verdict: string, note?: string, author: string}} v
 * @returns {Promise<{ok: true, title: string|null} >}
 */
export async function recordVerdict(registry, { cadastralNo, verdict, note = null, author }) {
  if (!VERDICTS.includes(verdict)) {
    throw new Error(`неизвестный вердикт «${verdict}». Можно: ${VERDICTS.join(', ')}`);
  }
  if (!cadastralNo) throw new Error('не указан кадастровый номер здания');
  if (!author) throw new Error('не указан автор вердикта');

  const [obj] = await registry.sql`
    SELECT id, title FROM kosmos.objects WHERE cadastral_no = ${cadastralNo} LIMIT 1`;
  if (!obj) throw new Error(`здание с кадастром ${cadastralNo} не найдено`);

  await registry.sql`
    INSERT INTO kosmos.verdicts (object_id, author, verdict, note)
    VALUES (${obj.id}, ${author}, ${verdict}, ${note})`;

  return { ok: true, title: obj.title };
}
