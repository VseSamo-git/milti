/**
 * Конкуренты МИЛТИ — точки сетей из OpenStreetMap.
 *
 * Дима просит лист «конкуренты» с адресами и информацией о новых точках
 * и закрытиях.
 *
 * 2ГИС для этого НЕ НУЖЕН. Проверено на живых данных 2026-07-16:
 * 489 точек шести сетей, у всех 100% координаты. Бесплатно, ODbL.
 *   Шоколадница 178 | Prime 83 | Правда кофе 81
 *   Братья Караваевы 76 | Drinkit 47 | Му-Му 20
 *
 * КАК ЛОВИМ НОВЫЕ И ЗАКРЫТИЯ. Сравниваем свежий обход с прошлым по osmId:
 *   появился в новом, не было в старом -> новая точка
 *   был в старом, нет в новом         -> кандидат на закрытие
 * «Кандидат», а не «закрылась»: OSM живёт правками людей, и объект может
 * пропасть из-за чужой ошибки. Поэтому статус, а не удаление — как и
 * везде в КОСМОСе.
 */
import { bboxString, escapeRe, MOSCOW_BBOX, parseElements, runOverpass } from '../lib/overpass.js';

export const SOURCE = 'osm_competitors';

/**
 * Сети конкурентов из ТЗ Димы.
 * `match` — как сеть подписана в OSM: имена пишут по-разному, поэтому
 * регэксп, а не точное совпадение.
 */
export const COMPETITOR_CHAINS = [
  { key: 'drinkit', match: 'Drinkit|Дринкит' },
  { key: 'french bakery', match: 'French Bakery|Френч Бейкери' },
  { key: 'братья караваевы', match: 'Караваев' },
  { key: 'prime', match: 'Prime|Прайм' },
  { key: 'муму', match: 'Му-Му|Муму' },
  { key: 'здрасте', match: 'Здрасте' },
  { key: 'шоколадница', match: 'Шоколадница' },
  { key: 'bodro coffee', match: 'Bodro|Бодро' },
  { key: 'parle market', match: 'Parle|Парле' },
  { key: 'правда кофе', match: 'Правда кофе|Правда Кофе' },
  { key: 'дни недели', match: 'Дни недели' },
];

function buildQuery(match, bbox) {
  return (
    '[out:json][timeout:120];' +
    `nwr["name"~"${escapeRe(match).replace(/\\\|/g, '|')}",i](${bboxString(bbox)});` +
    'out tags center 3000;'
  );
}

/**
 * Забрать точки одной сети.
 * @returns {{chain: string, name: string, lat: number, lon: number, osmId: string}[]}
 */
export async function fetchChain(chain, bbox = MOSCOW_BBOX) {
  const payload = await runOverpass(buildQuery(chain.match, bbox));
  const re = new RegExp(chain.match, 'i');

  return parseElements(payload)
    // Overpass ищет по подстроке, поэтому перепроверяем имя: запрос по
    // «Prime» иначе притащит «Primer», «Primavera» и прочее.
    .filter((el) => el.name && re.test(el.name))
    .map((el) => ({
      chain: chain.key,
      name: el.name,
      lat: el.lat,
      lon: el.lon,
      osmId: el.osmId,
      street: el.street,
      house: el.house,
    }));
}

/**
 * Забрать все сети конкурентов по Москве.
 * По одной сети за запрос: общий регэксп даёт 504 на публичном Overpass.
 */
export async function fetchAllCompetitors({ chains = COMPETITOR_CHAINS, bbox = MOSCOW_BBOX, onProgress } = {}) {
  const all = [];
  const seen = new Set();

  for (const chain of chains) {
    const items = await fetchChain(chain, bbox);
    for (const item of items) {
      if (seen.has(item.osmId)) continue;
      seen.add(item.osmId);
      all.push(item);
    }
    if (onProgress) onProgress(chain.key, items.length, all.length);
  }

  return all;
}

/**
 * Сравнить свежий обход с прошлым.
 *
 * @param {{osmId: string}[]} previous — точки прошлого обхода
 * @param {{osmId: string}[]} current — точки свежего обхода
 * @returns {{opened: object[], closedCandidates: object[], unchanged: number}}
 */
export function diffRounds(previous, current) {
  const prevIds = new Set(previous.map((p) => p.osmId));
  const currIds = new Set(current.map((c) => c.osmId));

  return {
    opened: current.filter((c) => !prevIds.has(c.osmId)),
    // Именно «кандидаты»: пропажа из OSM не доказывает закрытие.
    closedCandidates: previous.filter((p) => !currIds.has(p.osmId)),
    unchanged: current.filter((c) => prevIds.has(c.osmId)).length,
  };
}
