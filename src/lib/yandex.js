/**
 * Яндекс-геокодер с ЖЁСТКИМ дневным лимитом и кэшем.
 *
 * ПОЧЕМУ ЛИМИТ. Геокодер Яндекса дорогой сверх бесплатной квоты. Правило
 * (требование Эдуарда): НЕ БОЛЕЕ 900 запросов в сутки. Это не «напоминание»,
 * а предохранитель в коде — по достижении лимита geocode() бросает ошибку и
 * физически не даёт сделать 901-й запрос. Порог 900 (а не 1000) — запас, чтобы
 * параллельные прогоны/ретраи не пробили платную границу.
 *
 * КАК СЧИТАЕМ. Счётчик {date, count} в yandex_budget.json рядом со скриптами
 * (том смонтирован, переживает перезапуски контейнера). Новый день — счётчик
 * обнуляется. Кэш ответов в yandex_cache.json: повторный запрос того же адреса
 * НЕ тратит квоту (и не увеличивает счётчик).
 *
 * Порог настраивается через YANDEX_DAILY_CAP, ключ — YANDEX_GEOCODER_KEY.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CAP = Number(process.env.YANDEX_DAILY_CAP || 900);
const BUDGET_FILE = process.env.YANDEX_BUDGET_FILE || './yandex_budget.json';
const CACHE_FILE = process.env.YANDEX_CACHE_FILE || './yandex_cache.json';

const today = () => new Date().toISOString().slice(0, 10);

function loadBudget() {
  if (!existsSync(BUDGET_FILE)) return { date: today(), count: 0 };
  try {
    const b = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
    return b.date === today() ? b : { date: today(), count: 0 };
  } catch { return { date: today(), count: 0 }; }
}
function saveBudget(b) { writeFileSync(BUDGET_FILE, JSON.stringify(b)); }

let cache = null;
function loadCache() {
  if (cache) return cache;
  cache = existsSync(CACHE_FILE) ? (() => { try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; } })() : {};
  return cache;
}
function saveCache() { if (cache) writeFileSync(CACHE_FILE, JSON.stringify(cache)); }

/** Сколько запросов ещё можно сделать сегодня. */
export function budgetLeft() { return Math.max(0, CAP - loadBudget().count); }
export function budgetUsed() { return loadBudget().count; }
export const DAILY_CAP = CAP;

/**
 * Геокод по тексту (обычно «Москва, <название/адрес>»). Возвращает
 * {name, address, lat, lon, precision} или null (справочник не знает).
 * Бросает 'YANDEX_BUDGET' при исчерпании суточного лимита и 'YANDEX_KEY' без ключа.
 */
export async function geocode(query) {
  const c = loadCache();
  if (Object.prototype.hasOwnProperty.call(c, query)) return c[query]; // кэш — вне квоты

  const key = process.env.YANDEX_GEOCODER_KEY;
  if (!key) throw new Error('YANDEX_KEY: не задан YANDEX_GEOCODER_KEY');

  const b = loadBudget();
  if (b.count >= CAP) throw new Error(`YANDEX_BUDGET: суточный лимит ${CAP} исчерпан (сегодня ${b.count})`);

  const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${key}&geocode=${encodeURIComponent(query)}`
    + `&format=json&results=1&lang=ru_RU&bbox=36.80,55.14~37.97,56.03&rspn=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  // счётчик увеличиваем на КАЖДЫЙ реально ушедший запрос (даже 4xx его тарифицируют)
  b.count += 1; saveBudget(b);
  if (!res.ok) throw new Error(`yandex ${res.status}`);

  const members = (await res.json()).response.GeoObjectCollection.featureMember;
  let out = null;
  if (members && members.length) {
    const o = members[0].GeoObject;
    const [lon, lat] = o.Point.pos.split(' ').map(Number);
    const meta = o.metaDataProperty.GeocoderMetaData;
    out = { name: o.name || '', address: meta.text || '', lat, lon, precision: meta.precision || '' };
  }
  c[query] = out; saveCache(); // кэшируем и «не найдено», чтобы не тратить квоту повторно
  return out;
}
