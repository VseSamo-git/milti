/**
 * Bodro Coffee. Точки — JS-массив прямо в HTML страницы /bodrotogo/address
 * (Tilda). Страница отдаёт 403 без Referer на /bodrotogo. Ключи объектов без
 * кавычек — не строгий JSON, разбираем по-объектно регуляркой.
 * Проверено 2026-07-20: 29 точек; лендинг пишет «34 точки» — это stated.
 */
import { httpText } from '../../lib/http.js';
import { unescapeHtml, slugify } from '../../lib/parse.js';

const ADDR_URL = 'https://bodro.coffee/bodrotogo/address';
const LANDING_URL = 'https://bodro.coffee/bodrotogo';
const REFERER = 'https://bodro.coffee/bodrotogo';

// Блок одной точки: { ... lat: 55.7 ... lng: 37.5 ... }
const BLOCK_RE = /\{[^{}]*?lat:\s*[-\d.]+[^{}]*?\}/g;
const field = (block, key) => {
  const m = block.match(new RegExp(`${key}:\\s*"([^"]*)"`));
  return m ? unescapeHtml(m[1]) : null;
};
const num = (block, key) => {
  const m = block.match(new RegExp(`${key}:\\s*([-\\d.]+)`));
  return m ? Number(m[1]) : NaN;
};

export default {
  chain: 'bodro coffee',
  source: 'bodro.coffee',
  confidence: 'high',
  expectedMin: 25,

  async fetch() {
    const html = await httpText(ADDR_URL, { headers: { Referer: REFERER } });

    let stated = null;
    try {
      const landing = await httpText(LANDING_URL, { headers: { Referer: REFERER } });
      const m = landing.match(/(\d+)\s*точ(?:к|ек)/i);
      if (m) stated = Number(m[1]);
    } catch {
      // лендинг не обязателен: без него сверимся с expectedMin
    }

    const raw = [];
    for (const m of html.matchAll(BLOCK_RE)) {
      const block = m[0];
      const address = field(block, 'address');
      const tip = field(block, 'address_tip');
      const lat = num(block, 'lat');
      const lon = num(block, 'lng');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const full = [tip, address].filter(Boolean).join(' ');
      raw.push({ id: slugify(address || full) || String(raw.length), name: address || full || null, address: full, lat, lon });
    }
    return { stated, raw };
  },
};
