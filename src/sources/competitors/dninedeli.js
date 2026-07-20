/**
 * Дни недели. Одностраничник на Tilda; точки — в виджете Яндекс-конструктора
 * карт. Берём id конструктора с главной, затем JSON коллекции из виджета.
 * Проверено 2026-07-20: 13 меток (все Москва), одна — «СКОРО ОТКРЫТИЕ», её
 * исключаем: это ещё не работающая точка. Координаты [lon, lat].
 */
import { httpText } from '../../lib/http.js';
import { extractBalanced, unescapeHtml, slugify } from '../../lib/parse.js';

const HOME = 'https://dninedeli.com/';
const WIDGET = (id) =>
  `https://yandex.ru/map-widget/v1/?lang=ru_RU&source=constructor-api&um=constructor%3A${id}`;

export default {
  chain: 'дни недели',
  source: 'dninedeli.com',
  confidence: 'high',
  expectedMin: 12,

  async fetch() {
    const home = await httpText(HOME);
    const idMatch = home.match(/um=constructor%3A([a-f0-9]+)/i);
    if (!idMatch) throw new Error('не найден id конструктора карт на главной');

    const widget = await httpText(WIDGET(idMatch[1]));
    const from = widget.indexOf('"userMap"');
    const features = extractBalanced(from >= 0 ? widget.slice(from) : widget, '"features":', '[');

    const raw = features
      .filter((f) => {
        const t = `${f.title || ''} ${f.subtitle || ''}`;
        return !/скоро|открыти/i.test(t); // ещё не работает — не точка
      })
      .map((f) => {
        const [lon, lat] = f.coordinates || [];
        const address = unescapeHtml(f.subtitle);
        return { id: slugify(f.title || address), name: unescapeHtml(f.title) || null, address, lat, lon };
      })
      .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
    return { stated: null, raw };
  },
};
