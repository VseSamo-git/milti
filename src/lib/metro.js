/**
 * Справочник станций метро для маршрутов: разбор ответа OSM (Overpass) и поиск
 * ближайших станций к объекту. Данные тянутся один раз (scripts/fetch_metro.mjs),
 * здесь — только чистые функции над ними.
 */
import { distanceMeters } from './nearest.js';

/**
 * Станции метро из ответа Overpass: именованные, без входов, дедуп по имени.
 * @param {{elements?: Array}} overpass
 * @returns {{name: string, lat: number, lon: number}[]}
 */
export function parseStations(overpass) {
  const seen = new Set();
  const out = [];
  for (const el of overpass?.elements || []) {
    const tags = el.tags || {};
    const name = tags.name;
    if (!name) continue;
    if (tags.railway === 'subway_entrance') continue;
    const isStation = tags.station === 'subway' || tags.railway === 'station';
    if (!isStation) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, lat, lon });
  }
  return out;
}

/**
 * Ближайшие станции к точке: в пределах порога, по возрастанию расстояния.
 * @param {{name: string, lat: number, lon: number}[]} stations
 * @param {{maxMeters: number, limit: number}} opts
 * @returns {{name: string, lat: number, lon: number, distance: number}[]}
 */
export function nearestStations(stations, lat, lon, { maxMeters, limit }) {
  return stations
    .map((s) => ({ ...s, distance: distanceMeters(lat, lon, s.lat, s.lon) }))
    .filter((s) => s.distance <= maxMeters)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
