/**
 * Конкуренты МИЛТИ — точки сетей со store-locator'ов самих сетей.
 *
 * ПОЧЕМУ НЕ OSM. Раньше конкуренты брались из OpenStreetMap регэкспом по имени.
 * Проверено на живых данных 2026-07-20: покрытие 4–141%, непредсказуемо.
 *   French Bakery 6 из 154 (4%)   — сети в OSM почти нет;
 *   Правда кофе  81 из 153 (53%)  — половина;
 *   Prime       101 при ~76        — регэксп ловил «АЭИ ПРАЙМ», такси, стоматологии.
 * OSM — краудсорсинг: покрытие зависит от того, кто нанёс, а не от размера сети.
 * Первоисточник — сайт самой сети. Каждая сеть — свой адаптер в ./competitors/.
 *
 * КАНАРЕЙКА (главный урок). Раньше система считала «скрипт не упал» за «данные
 * собраны» и записала French Bakery = 6 как полный обход. Теперь каждый адаптер
 * возвращает stated — число, которое сеть пишет о СЕБЕ (напр. «79 заведений»).
 * Guard сверяет СЫРОЙ разбор со stated: мало относительно заявленного — парсер
 * сломан, сеть уходит в failed и в базу НЕ пишется. Молчаливая усушка теперь
 * невозможна: 6 при stated=154 — это failed, а не «полный обход».
 */
import { ADAPTERS } from './competitors/index.js';
import { isMoscow, looksOutsideMoscow } from '../lib/geo.js';

export const SOURCE = 'store_locators';

// Список сетей — для тестов и обратной совместимости (11 сетей ТЗ Димы).
export const COMPETITOR_CHAINS = ADAPTERS.map((a) => ({ key: a.chain, source: a.source }));

// Порог канарейки: ниже 70% от заявленного считаем парсер сломанным.
// Не 100%: сайт и карта могут расходиться на пару точек (открытия/закрытия
// между обновлением списка и счётчика). Но 6 из 154 (4%) — очевидная поломка.
const COVERAGE_FLOOR = 0.7;

/**
 * Оценить полноту разбора одной сети.
 * @param {number} rawCount — сколько точек распарсил адаптер (ДО фильтра Москвы)
 * @param {number|null} stated — сколько сеть заявляет о себе
 * @param {number|null} expectedMin — мягкий эталон из разведки, если stated нет
 * @returns {{status:'ok'|'estimate'|'broken', reason:string, ref:number|null}}
 */
export function checkCoverage(rawCount, stated, expectedMin = null) {
  const ref = stated ?? expectedMin;
  if (rawCount === 0) return { status: 'broken', reason: '0 точек — источник не отдал список', ref };
  if (!ref) return { status: 'estimate', reason: `${rawCount} точек, эталона для сверки нет`, ref: null };

  const ratio = rawCount / ref;
  if (ratio < COVERAGE_FLOOR) {
    return {
      status: 'broken',
      reason: `${rawCount} из ~${ref} (${Math.round(ratio * 100)}%) — парсер сломан`,
      ref,
    };
  }
  // stated есть и сошлось → «ok»; сверка была лишь с оценкой → «estimate».
  return {
    status: stated ? 'ok' : 'estimate',
    reason: `${rawCount} из ~${ref} (${Math.round(ratio * 100)}%)`,
    ref,
  };
}

/**
 * Собрать все сети конкурентов.
 * Падение или поломка одной сети НЕ роняет остальные и НЕ пишется в базу.
 *
 * @returns {{points: object[], failed: object[], coverage: object[]}}
 */
export async function fetchAllCompetitors({ adapters = ADAPTERS, onProgress } = {}) {
  const points = [];
  const failed = [];
  const coverage = [];
  const seen = new Set(); // дедуп по place_key: один ключ = одна строка в БД

  for (const adapter of adapters) {
    let result;
    try {
      result = await adapter.fetch();
    } catch (error) {
      failed.push({ chain: adapter.chain, reason: error.message });
      if (onProgress) onProgress({ chain: adapter.chain, error, moscow: null, total: points.length });
      continue;
    }

    const raw = result.raw || [];
    const verdict = checkCoverage(raw.length, result.stated ?? null, adapter.expectedMin ?? null);
    coverage.push({ chain: adapter.chain, raw: raw.length, stated: result.stated ?? null, ...verdict });

    if (verdict.status === 'broken') {
      // Сломанный парсер = частичный сбой. Не пишем ничего по этой сети,
      // старые точки не трогаем, громко сообщаем. Инвариант «сбой не молчит».
      failed.push({ chain: adapter.chain, reason: verdict.reason });
      if (onProgress) onProgress({ chain: adapter.chain, verdict, moscow: null, total: points.length });
      continue;
    }

    // С координатами — фильтр по bbox+адресу. Без координат (French Bakery)
    // судим только по адресу: не выдаёт область — считаем Москвой (сеть московская).
    const moscow = raw.filter((p) =>
      p.lat != null && p.lon != null
        ? isMoscow(p.lat, p.lon, p.address)
        : !looksOutsideMoscow(`${p.name || ''} ${p.address || ''}`)
    );
    let added = 0;
    for (const p of moscow) {
      const placeKey = `${adapter.chain}:${p.id}`;
      if (seen.has(placeKey)) continue; // одна точка сети продублирована в источнике
      seen.add(placeKey);
      added++;
      points.push({
        chain: adapter.chain,
        placeKey,
        name: p.name || null,
        lat: p.lat,
        lon: p.lon,
        address: p.address || null,
        source: adapter.source,
        confidence: adapter.confidence || 'high',
      });
    }
    if (onProgress) onProgress({ chain: adapter.chain, verdict, moscow: added, total: points.length });
  }

  return { points, failed, coverage };
}

/**
 * Сравнить свежий обход с прошлым по placeKey.
 * Безопасно только когда сеть НЕ в failed: канарейка гарантирует, что «мало
 * точек» — это failed, а не повод объявить сеть закрытой.
 */
export function diffRounds(previous, current) {
  const prevIds = new Set(previous.map((p) => p.placeKey ?? p.osmId));
  const currIds = new Set(current.map((c) => c.placeKey ?? c.osmId));
  const key = (x) => x.placeKey ?? x.osmId;
  return {
    opened: current.filter((c) => !prevIds.has(key(c))),
    closedCandidates: previous.filter((p) => !currIds.has(key(p))),
    unchanged: current.filter((c) => prevIds.has(key(c))).length,
  };
}
