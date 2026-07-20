/**
 * Мелкие помощники разбора HTML/JSON store-locator'ов.
 */

/**
 * Вырезать сбалансированный JSON-объект/массив из строки, начиная с позиции
 * первого встреченного `open`. Нужен там, где сайт вшивает GeoJSON прямо
 * в HTML (Prime, Дни недели): регуляркой такое не взять — скобки внутри строк.
 *
 * @param {string} text — исходный HTML
 * @param {string} anchor — подстрока-ориентир (напр. '"features":' или '"type":"FeatureCollection"')
 * @param {'{'|'['} open — открывающая скобка объекта
 * @param {{back?: boolean}} opts — back:true, когда открывающая скобка стоит
 *   ПЕРЕД якорем (напр. якорь '"type"' внутри объекта '{"type":...}'); иначе
 *   скобка ищется ПОСЛЕ якоря (напр. '[' после '"features":').
 * @returns {any} результат JSON.parse
 */
export function extractBalanced(text, anchor, open = '{', { back = false } = {}) {
  const close = open === '{' ? '}' : ']';
  const anchorAt = text.indexOf(anchor);
  if (anchorAt === -1) throw new Error(`якорь не найден: ${anchor}`);
  const start = back ? text.lastIndexOf(open, anchorAt) : text.indexOf(open, anchorAt);
  if (start === -1) throw new Error(`нет '${open}' ${back ? 'перед' : 'после'} якоря ${anchor}`);

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error(`незакрытая скобка от якоря ${anchor}`);
}

/** Транслитерируемый slug из адреса — стабильный ключ, когда у сайта нет id. */
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/&quot;|["']/g, '')
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Снять HTML-сущности, которые попадаются в адресах (&quot; и т.п.). */
export function unescapeHtml(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
