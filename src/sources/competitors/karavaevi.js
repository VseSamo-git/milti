/**
 * Братья Караваевы. Список зашит в статичный HTML страницы «наши кафе»:
 * у каждого div атрибуты data-search (адрес), data-lat, data-lng.
 * Проверено 2026-07-20: 79 точек, сайт сам пишет «79 заведений» — это stated.
 * URL требует слэш в конце, иначе 301 (redirect: follow в http.js это拾ит).
 */
import { httpText } from '../../lib/http.js';
import { unescapeHtml } from '../../lib/parse.js';

const URL = 'https://karavaevi.ru/nashi-kafe/';
// Один div: data-search="адрес" ... data-lat="55.8" data-lng="37.5"
const ITEM_RE = /data-search="([^"]*)"[^>]*?data-lat="([-\d.]+)"[^>]*?data-lng="([-\d.]+)"/g;

export default {
  chain: 'братья караваевы',
  source: 'karavaevi.ru',
  confidence: 'high',

  async fetch() {
    const html = await httpText(URL);
    // Канарейка: число, которое сеть пишет о себе («79 заведений»).
    const statedMatch = html.match(/(\d+)\s*заведени/i);
    const stated = statedMatch ? Number(statedMatch[1]) : null;

    const raw = [];
    for (const m of html.matchAll(ITEM_RE)) {
      const address = unescapeHtml(m[1]);
      raw.push({
        id: address ? address.replace(/\s+/g, '-').slice(0, 80) : String(raw.length),
        name: address || null,
        address,
        lat: Number(m[2]),
        lon: Number(m[3]),
      });
    }
    return { stated, raw };
  },
};
