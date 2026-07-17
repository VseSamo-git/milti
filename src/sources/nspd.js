/**
 * Геопортал НСПД — площадь зданий из ЕГРН.
 *
 * Эндпоинт недокументированный, но публичный. ФЗ-218 ст. 12 прямо называет
 * публичную кадастровую карту предназначенной «для использования
 * неограниченным кругом лиц ... без взимания платы».
 *
 * ==========================================================================
 * ПРАВОВЫЕ ИНВАРИАНТЫ. Нарушение = штраф юрлицу 350-600 тыс. руб.
 * (КоАП ст. 14.35 чч. 6-7). НЕ ОСЛАБЛЯТЬ БЕЗ ЮРИСТА.
 *
 *   1. Берём и храним ТОЛЬКО производные поля — площадь, этажность, год,
 *      назначение — в собственной табличной форме. Никогда не воспроизводим
 *      совокупность сведений выписки по утверждённым формам.
 *   2. НИКОГДА не сохраняем, не пересылаем и не прикладываем файлы
 *      с подписью или ЭЦП Росреестра/ППК — ни в базу, ни в Telegram,
 *      ни в Sheets.
 *
 * Это два условия изъятия ч. 27 ст. 62 ФЗ-218 — единственная законная
 * опора проекта. Запасного пути нет. Обоснование «мы используем внутри
 * и не перепродаём» НЕ работает: ч. 25 запрещает создание программ,
 * предоставляющих доступ к сведениям ЕГРН, без слов «за плату».
 *
 * Изъятие привязано к КОНТЕНТУ, а не к системе: один PDF с ЭЦП выводит
 * из-под ч. 27 именно эту передачу, даже если остальные 99% безупречны.
 * ==========================================================================
 *
 * ТРИ ГРАБЛИ, проверенные разведкой 2026-07-16:
 *
 *   1. Заголовок Referer обязателен — без него WAF отдаёт 403. Причём
 *      "https://nspd.gov.ru/map" и "https://nspd.gov.ru/" заблокированы
 *      СПЕЦИАЛЬНО: ими подписываются наивные скраперы. User-Agent не нужен.
 *   2. TLS: сертификат выпущен российским национальным УЦ, Node его не знает
 *      (SELF_SIGNED_CERT_IN_CHAIN). Подкладываем корневой Минцифры своим
 *      диспетчером undici — см. конструктор. NODE_EXTRA_CA_CERTS не годится:
 *      Node читает её только при старте процесса. Отключать проверку ЗАПРЕЩЕНО.
 *   3. Имя поля площади зависит от типа объекта — см. AREA_FIELD_BY_CATEGORY.
 */

import { readFileSync } from 'node:fs';
import { Agent, fetch as undiciFetch } from 'undici';

export const NSPD_ENDPOINT = 'https://nspd.gov.ru/api/geoportal/v2/search/geoportal';

// Имя поля площади зависит от categoryName.
// «Сооружения» намеренно отсутствуют: разведка показала, что они отдают
// null в площади. Это нормально — NULL легитимен.
export const AREA_FIELD_BY_CATEGORY = {
  'Здания': 'build_record_area',
  'Помещения': 'area',
};

export const SOURCE = 'nspd';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** NULL легитимен. Ноль — это выдумка. */
function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asInt(value) {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export class NspdClient {
  /**
   * @param {{nspdReferer: string, nspdRateLimitPerSec: number, caBundle: string|null}} cfg
   */
  constructor(cfg) {
    this.referer = cfg.nspdReferer;
    this.minIntervalMs = 1000 / (cfg.nspdRateLimitPerSec || 1);
    this.lastCallAt = 0;

    // Сертификат подключаем СВОИМ диспетчером, а не через NODE_EXTRA_CA_CERTS.
    // Причина: эта переменная читается Node только при старте процесса —
    // выставить её из кода уже поздно, и все запросы молча падают в
    // «fetch failed». Проверено на живых данных.
    // Проверку сертификата НЕ отключаем: подкладываем корневой Минцифры.
    this.dispatcher = cfg.caBundle
      ? new Agent({ connect: { ca: readFileSync(cfg.caBundle, 'utf8') } })
      : undefined;
  }

  async #throttle() {
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastCallAt = Date.now();
  }

  /**
   * Сырой ответ по кадастровому номеру. null, если объект не найден.
   * Не быстрее заданного лимита: троттлинга не замечено именно на 1 req/s,
   * ускорение — риск бана WAF.
   */
  async fetchRaw(cadastralNo) {
    await this.#throttle();

    const url = `${NSPD_ENDPOINT}?query=${encodeURIComponent(cadastralNo)}&thematicSearchId=1`;
    const response = await undiciFetch(url, {
      headers: { Referer: this.referer },
      dispatcher: this.dispatcher,
    });

    if (response.status === 204 || response.status === 404) return null;
    if (response.status === 403) {
      throw new Error(
        'НСПД отдал 403 — проверьте заголовок Referer. ' +
          'Значения nspd.gov.ru/map и nspd.gov.ru/ заблокированы специально.'
      );
    }
    if (!response.ok) {
      throw new Error(`НСПД отдал HTTP ${response.status} на ${cadastralNo}`);
    }

    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  /**
   * Разобрать ответ в производные поля.
   * null, если ничего не найдено или это не здание/помещение.
   */
  parse(payload) {
    const features = payload?.data?.features;
    if (!Array.isArray(features) || features.length === 0) return null;

    const properties = features[0].properties || {};
    const category = properties.categoryName;
    const areaField = AREA_FIELD_BY_CATEGORY[category];
    if (!areaField) return null; // Сооружения, Земельные участки — не наши

    const options = properties.options || {};

    return {
      cadastralNo: options.cad_num || null,
      areaSqm: asNumber(options[areaField]),
      floors: asInt(options.floors),
      builtYear: asInt(options.year_built),
      purpose: options.purpose || null,
      categoryName: category,
      // Канонический адрес из ЕГРН — чище, чем в перечне 700-ПП,
      // где он лежит глифами и требует CMap.
      readableAddress: options.readable_address || null,
    };
  }
}
