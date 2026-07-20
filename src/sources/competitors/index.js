/**
 * Реестр адаптеров конкурентов. Один адаптер = одна сеть = один сайт.
 *
 * Контракт адаптера:
 *   chain        — ключ сети (совпадает с ТЗ Димы)
 *   source       — домен-первоисточник (провенанс, пишется в БД построчно)
 *   confidence   — 'high' | 'low' (low для вторичных источников, напр. карты)
 *   expectedMin? — мягкий эталон из разведки, если сеть не пишет число о себе
 *   fetch()      — async → { stated: number|null, raw: [{id,name,address,lat,lon}] }
 *                  raw — ВСЕ точки сети (Москва + регионы); Москву режет раннер,
 *                  канарейка сверяет длину raw со stated/expectedMin.
 *
 * ПОКА НЕ ПОДКЛЮЧЕНЫ — нужен вторичный источник (см. HANDOFF):
 *   drinkit       — сайт за активной анти-бот защитой (ServicePipe), эндпоинт
 *                   только через headless-браузер; обход не встраиваем;
 *   здрасте       — за анти-бот защитой (Beget jshield); обход не встраиваем;
 *   parle market  — своего locator нет вообще, только вторичные карты.
 * Все три помечаются в отчёте как «нет первоисточника», а НЕ молчаливый ноль.
 * French Bakery подключён, но БЕЗ координат: сеть их не публикует (только адреса).
 */
import shoko from './shoko.js';
import pravda from './pravda.js';
import karavaevi from './karavaevi.js';
import prime from './prime.js';
import bodro from './bodro.js';
import mumu from './mumu.js';
import dninedeli from './dninedeli.js';
import frenchbakery from './frenchbakery.js';

export const ADAPTERS = [shoko, pravda, karavaevi, prime, bodro, mumu, dninedeli, frenchbakery];
