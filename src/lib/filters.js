/**
 * Маршрутизация объектов по видам рабочего стола.
 *
 * Серая зона существует потому, что оценочная площадь имеет погрешность
 * порядка ±25%: оценка 8 500 м² может оказаться настоящими 11 000 м².
 *
 * КЛЮЧЕВОЕ: правило серой зоны применяется ТОЛЬКО к оценкам.
 * Для точной площади порог — чёткая линия. Точные 9 500 м² — это не
 * «спорный объект», а «не наш объект»: порог заявлен источником,
 * сомневаться не в чем. Иначе вид «НА ПРОВЕРКУ» забьётся заведомо
 * мелкими зданиями и Дима перестанет в него заглядывать.
 */

export const AREA_THRESHOLD = 10_000;
export const GREY_ZONE_FLOOR = 8_000;

export const Destination = Object.freeze({
  MAIN: 'основной_вид',
  REVIEW: 'на_проверку',
  NONE: 'не_показывать',
});

export const Confidence = Object.freeze({
  EXACT: 'точно',
  ESTIMATE: 'оценка',
  UNKNOWN: 'неизвестно',
});

/**
 * @param {{sqm: number|null, confidence: string}} area
 * @returns {string} одно из значений Destination
 */
export function route(area) {
  if (!area || area.sqm === null || area.sqm === undefined) {
    return Destination.NONE;
  }
  if (area.confidence === Confidence.UNKNOWN) {
    return Destination.NONE;
  }

  if (area.confidence === Confidence.EXACT) {
    // Порог заявлен источником — серой зоны нет.
    return area.sqm >= AREA_THRESHOLD ? Destination.MAIN : Destination.NONE;
  }

  // Оценка: погрешность ±25%, поэтому у порога есть ширина.
  if (area.sqm >= AREA_THRESHOLD) return Destination.MAIN;
  if (area.sqm >= GREY_ZONE_FLOOR) return Destination.REVIEW;
  return Destination.NONE;
}

/**
 * Расхождение между источниками у порога — само по себе повод для проверки.
 *
 * ЕГРН меряет ЗДАНИЕ, каталоги меряют КОМПЛЕКС: Neva Towers в ЦИАН —
 * 356 994 м², но это две башни. Если два источника разошлись через порог,
 * объект спорный независимо от меток достоверности.
 *
 * @param {number|null} areaEgrn
 * @param {number|null} areaCatalog
 * @returns {boolean} true, если объект надо отправить на проверку
 */
export function sourcesDisagreeAtThreshold(areaEgrn, areaCatalog) {
  if (areaEgrn === null || areaCatalog === null) return false;
  if (areaEgrn === undefined || areaCatalog === undefined) return false;
  const egrnPasses = areaEgrn >= AREA_THRESHOLD;
  const catalogPasses = areaCatalog >= AREA_THRESHOLD;
  return egrnPasses !== catalogPasses;
}
