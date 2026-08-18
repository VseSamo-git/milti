/**
 * Разбор секторов для чтения — вторая форма той же карты.
 *
 * Картинка (build_sector_map.mjs) отвечает на вопрос «где границы».
 * Этот разбор отвечает на вопросы «что внутри» и «чего не хватает»:
 * таблица секторов с крупнейшими объектами и матрица непокрытого по
 * кольцам и направлениям от Кремля.
 *
 * Кольца и направления, а не округа: округ есть только у 18 адресов из 1839,
 * а координата есть почти у всех. Считаем от того, что в данных реально есть.
 *
 * Данные: docs/_baza_full.tsv — выгрузка «Базы» с сервера,
 * `ключ \t тип \t "lat, lon" \t название \t адрес \t площадь`.
 *
 * Запуск: node scripts/build_sector_report.mjs
 */
import fs from 'node:fs';
import { SECTORS, sectorOf } from '../src/lib/sectors.js';

const KREMLIN = { lat: 55.7522, lon: 37.6156 };
const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LON = 62.5;           // на широте Москвы градус долготы вдвое короче

const RINGS = ['внутри Садового', 'Садовое — ТТК', 'ТТК — МКАД', 'за МКАД'];
const DIRS = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];

const offset = (lat, lon) => ({
  y: (lat - KREMLIN.lat) * KM_PER_DEG_LAT,
  x: (lon - KREMLIN.lon) * KM_PER_DEG_LON,
});
const ringOf = (lat, lon) => {
  const { x, y } = offset(lat, lon);
  const d = Math.hypot(x, y);
  return d < 2.2 ? RINGS[0] : d < 5.5 ? RINGS[1] : d < 19 ? RINGS[2] : RINGS[3];
};
const dirOf = (lat, lon) => {
  const { x, y } = offset(lat, lon);
  const angle = (Math.atan2(x, y) * 180) / Math.PI;
  return DIRS[Math.round(((angle + 360) % 360) / 45) % 8];
};

const rows = fs.readFileSync('docs/_baza_full.tsv', 'utf8').split('\n').filter(Boolean).map((l) => {
  const [key, type, coords, title, addr, area] = l.split('\t');
  const [lat, lon] = (coords || '').split(',').map((v) => parseFloat(v));
  return { key, type, lat, lon, title: title || '', addr: addr || '', area: parseInt(area, 10) || null };
});

const inside = new Map(SECTORS.map((s) => [s.id, []]));
const outside = [];
const noCoords = [];
for (const r of rows) {
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) { noCoords.push(r); continue; }
  const s = sectorOf(r.lat, r.lon);
  if (s) inside.get(s.id).push(r); else outside.push(r);
}
const inCount = rows.length - outside.length - noCoords.length;
const days = Math.floor(inCount / 10 / 5);

// Матрица непокрытого. Пустая клетка честнее нуля: пусто значит «там ничего нет».
const grid = new Map();
let max = 0;
for (const r of outside) {
  const k = `${ringOf(r.lat, r.lon)}|${dirOf(r.lat, r.lon)}`;
  const n = (grid.get(k) || 0) + 1;
  grid.set(k, n);
  if (n > max) max = n;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nbsp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const sectorRows = SECTORS.map((s) => {
  const list = inside.get(s.id);
  const types = {};
  for (const r of list) types[r.type] = (types[r.type] || 0) + 1;
  const breakdown = Object.entries(types).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${esc(k)}&nbsp;${v}`).join(', ') || '—';
  const biggest = list.filter((r) => r.area).sort((a, b) => b.area - a.area)[0];
  const anchor = biggest
    ? `${esc(biggest.title || '(без названия)')} <i>${nbsp(biggest.area)} м²</i>`
    : (list[0] ? esc(list[0].title || '(без названия)') : '—');
  const nameless = list.filter((r) => !r.title || r.title === '(без названия)').length;
  return `<tr>
      <td class="idx">${s.id}</td>
      <td class="words">${esc(s.words)}${nameless ? `<span class="warn-inline">без названия: ${nameless}</span>` : ''}</td>
      <td class="n">${list.length}</td>
      <td class="types">${breakdown}</td>
      <td class="anchor">${anchor}</td>
    </tr>`;
}).join('\n    ');

const matrixRows = RINGS.map((ring) => {
  const cells = DIRS.map((d) => {
    const n = grid.get(`${ring}|${d}`) || 0;
    if (!n) return '<td class="cell empty"></td>';
    const heat = (0.10 + 0.85 * (n / max)).toFixed(2);
    return `<td class="cell" style="--heat:${heat}"><span>${n}</span></td>`;
  }).join('');
  const total = DIRS.reduce((a, d) => a + (grid.get(`${ring}|${d}`) || 0), 0);
  return `<tr><th scope="row">${ring}</th>${cells}<td class="n">${total}</td></tr>`;
}).join('\n      ');

const topSectors = [...SECTORS].map((s) => ({ s, n: inside.get(s.id).length })).sort((a, b) => b.n - a.n);

const html = `<title>Что в секторах</title>
<style>
  :root {
    --ground: #f5f6f9; --panel: #ffffff; --ink: #13171d; --soft: #5f6875;
    --line: #dce0e8; --accent: #8c2f1e; --heat-base: 140 47 30;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #0d1015; --panel: #151920; --ink: #e6eaf1; --soft: #949eac;
      --line: #272e38; --accent: #e07a5b; --heat-base: 224 122 91;
    }
  }
  :root[data-theme="dark"] {
    --ground: #0d1015; --panel: #151920; --ink: #e6eaf1; --soft: #949eac;
    --line: #272e38; --accent: #e07a5b; --heat-base: 224 122 91;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 16px/1.6 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 940px; margin: 0 auto; padding: 44px 22px 80px; display: flex; flex-direction: column; gap: 40px; }
  .eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: var(--soft); }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: clamp(29px, 4.2vw, 44px); margin: 8px 0 0; letter-spacing: -0.01em; text-wrap: balance; }
  h2 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 25px; margin: 0 0 4px; }
  p { margin: 0; max-width: 66ch; }
  .soft { color: var(--soft); }
  section { display: flex; flex-direction: column; gap: 14px; }
  .verdict { border-left: 3px solid var(--accent); padding: 4px 0 4px 18px; display: flex; flex-direction: column; gap: 8px; }
  .verdict b { font-family: Georgia, serif; font-weight: 400; font-size: 21px; }
  .figures { display: flex; flex-wrap: wrap; gap: 10px; }
  .fig { background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 13px 18px; min-width: 146px; }
  .fig b { display: block; font-family: Georgia, serif; font-size: 29px; font-weight: 400; line-height: 1.15; }
  .fig span { font-size: 13px; color: var(--soft); }
  .fig.alarm { border-color: var(--accent); }
  .fig.alarm b { color: var(--accent); }
  .scroll { overflow-x: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 3px; }
  table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  thead th { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--soft); font-weight: 600; white-space: nowrap; }
  tbody tr:last-child td, tbody tr:last-child th { border-bottom: none; }
  .idx { font-family: Georgia, serif; font-size: 17px; color: var(--soft); width: 34px; }
  .words { min-width: 240px; }
  .warn-inline { display: block; font-size: 12px; color: var(--accent); margin-top: 2px; }
  .n { text-align: right; font-family: Georgia, serif; font-size: 18px; white-space: nowrap; }
  .types { color: var(--soft); font-size: 13px; min-width: 180px; }
  .anchor { min-width: 190px; }
  .anchor i { display: block; font-style: normal; color: var(--soft); font-size: 12.5px; }
  .matrix th[scope="row"] { white-space: nowrap; font-weight: 400; color: var(--soft); }
  .matrix thead th { text-align: center; }
  .cell { text-align: center; padding: 0; }
  .cell span { display: block; padding: 11px 8px; background: rgb(var(--heat-base) / var(--heat)); color: #fff; font-weight: 600; }
  .cell.empty { background: transparent; }
  ol.asks { margin: 0; padding-left: 22px; display: flex; flex-direction: column; gap: 10px; }
  ol.asks li { padding-left: 4px; }
  footer { color: var(--soft); font-size: 13px; border-top: 1px solid var(--line); padding-top: 16px; }
  @media (max-width: 600px) { .words, .types, .anchor { min-width: 0; } table { font-size: 13.5px; } }
</style>
<div class="wrap">
  <header>
    <span class="eyebrow">МИЛТИ · разбор нарезки Димы · 18 августа 2026</span>
    <h1>Что лежит в секторах и чего в них нет</h1>
  </header>

  <section class="verdict">
    <b>Нарезка кончится примерно через ${days} рабочих дней.</b>
    <p class="soft">В 14 секторов Димы попало ${inCount} объектов Базы из ${rows.length}. Пять менеджеров
      берут 50 адресов в день — значит, около ${days} дней работы, и адреса в секторах исчерпаны.
      Остальные ${nbsp(outside.length)} объектов лежат вне всех секторов, в основном между ТТК и МКАД.</p>
  </section>

  <div class="figures">
    <div class="fig"><b>${inCount}</b><span>внутри секторов</span></div>
    <div class="fig alarm"><b>${nbsp(outside.length)}</b><span>вне нарезки</span></div>
    <div class="fig"><b>${topSectors[0].n}</b><span>в самом полном (№${topSectors[0].s.id})</span></div>
    <div class="fig"><b>${topSectors[topSectors.length - 1].n}</b><span>в самом пустом (№${topSectors[topSectors.length - 1].s.id})</span></div>
  </div>

  <section>
    <h2>Секторы</h2>
    <p class="soft">Слова — дословно от Димы. Последняя колонка: крупнейший по площади объект внутри,
      чтобы было видно, ради чего туда ехать.</p>
    <div class="scroll">
      <table>
        <thead><tr><th>№</th><th>Границы со слов Димы</th><th>Объектов</th><th>Из них</th><th>Крупнейший объект</th></tr></thead>
        <tbody>
    ${sectorRows}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Где дыры</h2>
    <p class="soft">Объекты вне нарезки, разложенные по кольцам и направлению от Кремля.
      Округ в адресе есть только у 18 строк, а координата — почти у всех, поэтому считаем по географии.
      Чем темнее клетка, тем больше пропущено.</p>
    <div class="scroll">
      <table class="matrix">
        <thead><tr><th></th>${DIRS.map((d) => `<th>${d}</th>`).join('')}<th class="n">всего</th></tr></thead>
        <tbody>
      ${matrixRows}
        </tbody>
      </table>
    </div>
    <p class="soft">Кольцо «ТТК — МКАД» не покрыто ни одним сектором целиком: там ${nbsp(RINGS.slice(2, 3).map((r) => DIRS.reduce((a, d) => a + (grid.get(`${r}|${d}`) || 0), 0))[0])} объектов
      во все стороны. Внутри Садового и между Садовым и ТТК дыры точечные — там нарезка работает.</p>
  </section>

  <section>
    <h2>Что из этого следует</h2>
    <p>Нарезка держит маршруты примерно ${days} рабочих дней. Дальше нужна либо вторая очередь
      секторов — прежде всего ЮЗ и Ю между ТТК и МКАД, где пропущено больше всего, — либо
      разрешение добирать объекты вне сектора, когда десяти не набралось.</p>
    <p>Это и остальные открытые развилки собраны в один список для Димы, с предложенным
      ответом на каждую: <a href="https://claude.ai/code/artifact/1bf8787b-1024-4431-8943-19e3e6fda6cc">шесть вопросов</a>. Здесь их намеренно нет —
      чтобы два списка не разъехались.</p>
  </section>

  <footer>
    Считано по живой базе, ${rows.length} строк листа «База»${noCoords.length ? `; ${noCoords.length} строк без координат не попали никуда — им нужна геопривязка` : ''}.
    Колледжи, Подмосковье и БЦ 5–10 тыс. м² уже вычтены по решению Димы.
  </footer>
</div>
`;

fs.writeFileSync('docs/секторы-разбор.html', html);
console.log(`разбор: ${html.length} символов | внутри ${inCount} | вне ${outside.length} | без координат ${noCoords.length}`);
