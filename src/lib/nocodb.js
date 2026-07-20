/**
 * Клиент NocoDB — витрины Димы.
 *
 * РОЛИ. NocoDB — то, что Дима открывает; Postgres — то, где данные живут
 * и считаются. Конвейер считает в Postgres (SQL, констрейнты, вычитание)
 * и выкладывает готовые списки сюда. Дима про Postgres не знает.
 *
 * ПРОВЕРЕНО НА ЖИВОМ API 2026-07-20:
 *
 *   1. Опции SingleSelect задаются полем `dtxp` строкой вида "'а','б'".
 *      Формат colOptions.options, который выглядит «более v2», проверить
 *      не удалось, а dtxp работает — опции читаются обратно. Не чините
 *      то, что не сломано.
 *   2. Токен может быть выдан на ОДНУ базу: GET /meta/bases отдаёт 403,
 *      а GET /meta/bases/{id}/tables — 200. Это нормально и правильно,
 *      не считайте 403 на списке баз признаком мёртвого токена.
 *   3. app.nocodb.com изредка отваливается по таймауту соединения,
 *      причём таблица при этом успевает создаться. Поэтому все вызовы
 *      идут через withRetry, а создание таблиц — идемпотентно по имени.
 */
import { withRetry } from './retry.js';

export class NocodbClient {
  /**
   * @param {{nocodbUrl: string, nocodbToken: string, nocodbBase: string}} cfg
   */
  constructor(cfg) {
    if (!cfg.nocodbToken) throw new Error('KOSMOS_NOCODB_TOKEN не задан');
    if (!cfg.nocodbBase) throw new Error('KOSMOS_NOCODB_BASE не задан');
    this.host = cfg.nocodbUrl.replace(/\/+$/, '');
    this.base = cfg.nocodbBase;
    this.headers = { 'xc-token': cfg.nocodbToken, 'Content-Type': 'application/json' };
  }

  async #call(path, init = {}) {
    const response = await withRetry(
      () => fetch(`${this.host}${path}`, { ...init, headers: this.headers }),
      { attempts: 4, backoffMs: 1500 }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`NocoDB ${init.method || 'GET'} ${path}: HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  /** Таблицы базы: заголовок -> id. */
  async tables() {
    const payload = await this.#call(`/api/v2/meta/bases/${this.base}/tables`);
    return new Map((payload.list || []).map((t) => [t.title, t.id]));
  }

  /**
   * Создать таблицу. Идемпотентности здесь НЕТ намеренно: решение
   * «создавать или пропустить» принимает вызывающий, потому что только он
   * знает, чем таблицу наполнять.
   */
  async createTable(title, columns) {
    const payload = await this.#call(`/api/v2/meta/bases/${this.base}/tables`, {
      method: 'POST',
      body: JSON.stringify({ title, table_name: title, columns }),
    });
    return payload.id;
  }

  async deleteTable(tableId) {
    await this.#call(`/api/v2/meta/tables/${tableId}`, { method: 'DELETE' });
  }

  /** Колонки таблицы — чтобы проверять, что создалось, а не верить на слово. */
  async columns(tableId) {
    const payload = await this.#call(`/api/v2/meta/tables/${tableId}`);
    return payload.columns || [];
  }

  /**
   * Залить строки пачками.
   *
   * Пачка 50: API принимает массив, но на больших пачках растёт риск
   * таймаута, а повтор целой пачки дороже повтора мелкой.
   *
   * @returns {Promise<number>} сколько строк ушло
   */
  async insert(tableId, rows, { chunk = 50, onProgress } = {}) {
    let sent = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const slice = rows.slice(i, i + chunk);
      await this.#call(`/api/v2/tables/${tableId}/records`, {
        method: 'POST',
        body: JSON.stringify(slice),
      });
      sent += slice.length;
      if (onProgress) onProgress(sent, rows.length);
    }
    return sent;
  }

  /**
   * Создать срез (grid-вид) с фильтрами и сортировкой.
   *
   * Фильтры адресуют колонки по id, а не по имени, поэтому сначала
   * читаем колонки таблицы. Молчаливо пропустить несуществующую колонку
   * нельзя: срез тогда покажет всё подряд, и Дима примет это за данные.
   *
   * @param {string} tableId
   * @param {{title: string, filters?: object[], sorts?: object[]}} def
   */
  async createView(tableId, def) {
    const cols = await this.columns(tableId);
    const idByTitle = new Map(cols.map((c) => [c.title, c.id]));

    const view = await this.#call(`/api/v2/meta/tables/${tableId}/grids`, {
      method: 'POST',
      body: JSON.stringify({ title: def.title }),
    });

    for (const f of def.filters || []) {
      const columnId = idByTitle.get(f.column);
      if (!columnId) throw new Error(`срез «${def.title}»: нет колонки «${f.column}»`);
      await this.#call(`/api/v2/meta/views/${view.id}/filters`, {
        method: 'POST',
        body: JSON.stringify({
          fk_column_id: columnId,
          comparison_op: f.op,
          value: f.value,
          logical_op: 'and',
        }),
      });
    }

    for (const s of def.sorts || []) {
      const columnId = idByTitle.get(s.column);
      if (!columnId) throw new Error(`срез «${def.title}»: нет колонки «${s.column}»`);
      await this.#call(`/api/v2/meta/views/${view.id}/sorts`, {
        method: 'POST',
        body: JSON.stringify({ fk_column_id: columnId, direction: s.direction }),
      });
    }

    return view.id;
  }

  /** Сколько строк уже лежит — чтобы не заливать повторно. */
  async count(tableId) {
    const payload = await this.#call(`/api/v2/tables/${tableId}/records/count`);
    return payload.count ?? 0;
  }

  /**
   * Стереть все строки таблицы, оставив саму таблицу и её виды.
   *
   * Удаляем строки, а не таблицу: у Димы на таблице живут фильтры,
   * сортировки и виды «Новые»/«Закрытия». Пересоздание таблицы снесло бы
   * их вместе с данными — а это его работа, а не наша.
   *
   * @returns {Promise<number>} сколько строк удалено
   */
  async clear(tableId, { chunk = 100 } = {}) {
    let removed = 0;

    // Идём страницами, пока строки есть. Смещение не двигаем: после
    // удаления страницы следующая сама встаёт на её место.
    for (;;) {
      const page = await this.#call(`/api/v2/tables/${tableId}/records?limit=${chunk}&fields=Id`);
      const ids = (page.list || []).map((row) => ({ Id: row.Id })).filter((r) => r.Id !== undefined);
      if (ids.length === 0) return removed;

      await this.#call(`/api/v2/tables/${tableId}/records`, {
        method: 'DELETE',
        body: JSON.stringify(ids),
      });
      removed += ids.length;
    }
  }
}

/**
 * Координаты строкой для витрины — или null, если их нет.
 *
 * ГРАБЛИ, оплаченные ошибкой: Number(null) === 0, поэтому наивное
 * `${Number(lat).toFixed(6)}` превращает отсутствующую координату
 * в «0.000000, 0.000000» — точку в Атлантике. 153 точки French Bakery
 * уехали туда, прежде чем это заметили. Пустая ячейка честнее выдуманной.
 */
export function formatCoords(lat, lon) {
  // Пустая строка тоже пустое место: Number('') === 0, и без этой проверки
  // '' проезжает как законный ноль. Поймано тестом, не глазами.
  const missing = (v) => v === null || v === undefined || v === '';
  if (missing(lat) || missing(lon)) return null;

  const [a, b] = [Number(lat), Number(lon)];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return `${a.toFixed(6)}, ${b.toFixed(6)}`;
}

/** Текстовая колонка. */
export const text = (title) => ({ title, uidt: 'SingleLineText' });

/** Числовая колонка — площади и количества, чтобы сортировались как числа. */
export const num = (title) => ({ title, uidt: 'Number' });

/**
 * Колонка-выбор. Опции задаются через dtxp — проверено на живом API.
 */
export const select = (title, options) => ({
  title,
  uidt: 'SingleSelect',
  dtxp: options.map((o) => `'${o}'`).join(','),
});
