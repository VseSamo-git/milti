/**
 * Карта секторов для Димы — HTML-страница, по которой он правит границы.
 *
 * Границы нарисованы по его словам, значит могут быть поняты не так. Поэтому
 * страница показывает не «результат», а предмет для правки: полигон, его
 * дословное описание и сколько объектов внутрь попало. Плюс главный вывод,
 * ради которого всё считалось: сколько дней работы нарезка вообще выдержит.
 *
 * Данные: docs/_baza_coords.tsv — выгрузка «Базы» с сервера (там живёт БД),
 * формат `ключ \t тип \t "lat, lon" \t название \t адрес`.
 *
 * Запуск: node scripts/build_sector_map.mjs
 */
import fs from 'node:fs';
import { SECTORS, sectorOf } from '../src/lib/sectors.js';

const rows = fs.readFileSync('docs/_baza_coords.tsv', 'utf8').split('\n').filter(Boolean).map((l) => {
  const [key, type, coords, title, addr] = l.split('\t');
  const [lat, lon] = (coords || '').split(',').map((v) => parseFloat(v));
  return { key, type, lat, lon, title: title || '', addr: addr || '' };
});
const metro = JSON.parse(fs.readFileSync('docs/metro.json', 'utf8')).stations;

// Колледжи Дима удалил 18.08 — на карте их нет.
const live = rows.filter((r) => r.type !== 'Колледж');
const inside = new Map(SECTORS.map((s) => [s.id, []]));
const outside = [];
let noCoords = 0;
for (const r of live) {
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) { noCoords++; continue; }
  const s = sectorOf(r.lat, r.lon);
  if (s) inside.get(s.id).push(r); else outside.push(r);
}

const BOX = { south: 55.555, north: 55.925, west: 37.32, east: 37.92 };
const W = 1000;
const H = Math.round((W * (BOX.north - BOX.south)) / ((BOX.east - BOX.west) * 0.56));
const X = (lon) => (((lon - BOX.west) / (BOX.east - BOX.west)) * W).toFixed(1);
const Y = (lat) => (((BOX.north - lat) / (BOX.north - BOX.south)) * H).toFixed(1);
const inBox = (r) => r.lat > BOX.south && r.lat < BOX.north && r.lon > BOX.west && r.lon < BOX.east;

// Четырнадцать различимых оттенков одной светлоты — не радуга и не пастель.
const HUE = [8, 30, 48, 70, 96, 130, 158, 178, 196, 214, 232, 258, 288, 322];
const color = (i) => `hsl(${HUE[i]} 52% 46%)`;

// Станции, которые Дима называл: подписи для ориентира, а не весь справочник.
const NAMED = new Set(['Полянка', 'Третьяковская', 'Серпуховская', 'Павелецкая', 'Тульская',
  'Технопарк', 'ЗИЛ', 'Автозаводская', 'Кожуховская', 'Марксистская', 'Текстильщики',
  'Нижегородская', 'Римская', 'Чкаловская', 'Красные Ворота', 'Комсомольская', 'Рижская',
  'Бутырская', 'Дмитровская', 'Савёловская', 'Тимирязевская', 'Сокол', 'Динамо', 'Белорусская',
  'Маяковская', 'Новослободская', 'Баррикадная', 'Краснопресненская', 'Смоленская', 'Киевская',
  'Кутузовская', 'Парк Победы', 'Фили', 'Багратионовская', 'Фрунзенская', 'Спортивная',
  'Добрынинская']);

const dots = (list, cls, fill) => list.filter(inBox)
  .map((r) => `<circle class="${cls}" cx="${X(r.lon)}" cy="${Y(r.lat)}" r="3"${fill ? ` fill="${fill}"` : ''}/>`)
  .join('');

const polys = SECTORS.map((s, i) => {
  const pts = s.polygon.map(([la, lo]) => `${X(lo)},${Y(la)}`).join(' ');
  const cx = (s.polygon.reduce((a, [, lo]) => a + Number(X(lo)), 0) / s.polygon.length).toFixed(1);
  const cy = (s.polygon.reduce((a, [la]) => a + Number(Y(la)), 0) / s.polygon.length).toFixed(1);
  return { s, i, pts, cx, cy };
});

const svg = [
  `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Карта четырнадцати секторов Москвы">`,
  `<g class="metro">${metro.filter(inBox).map((m) => `<circle cx="${X(m.lon)}" cy="${Y(m.lat)}" r="1.6"/>`).join('')}</g>`,
  `<g class="out">${dots(outside, 'dot-out')}</g>`,
  polys.map(({ s, i, pts }) => `<g class="sector" data-sector="${s.id}">`
    + `<polygon points="${pts}" fill="${color(i)}" fill-opacity="0.16" stroke="${color(i)}" stroke-width="2"/>`
    + dots(inside.get(s.id), 'dot-in', color(i)) + '</g>').join(''),
  `<g class="labels">${polys.map(({ s, i, cx, cy }) => `<g data-sector="${s.id}">`
    + `<circle cx="${cx}" cy="${cy}" r="15" fill="${color(i)}"/>`
    + `<text x="${cx}" y="${Number(cy) + 5}" text-anchor="middle">${s.id}</text></g>`).join('')}</g>`,
  `<g class="stations">${metro.filter((m) => NAMED.has(m.name) && inBox(m))
    .map((m) => `<text x="${Number(X(m.lon)) + 6}" y="${Number(Y(m.lat)) - 5}">${m.name}</text>`).join('')}</g>`,
  '</svg>',
].join('\n  ');

const inCount = live.length - outside.length - noCoords;
const days = Math.floor(inCount / 10 / 5);

const cards = polys.map(({ s, i }) => {
  const list = inside.get(s.id);
  const types = {};
  for (const r of list) types[r.type] = (types[r.type] || 0) + 1;
  const breakdown = Object.entries(types).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`).join(' · ') || 'пусто';
  return `<li data-sector="${s.id}" tabindex="0">`
    + `<span class="swatch" style="background:${color(i)}"></span>`
    + `<span class="num">${s.id}</span>`
    + `<span class="words">${s.words}</span>`
    + `<span class="count">${list.length}</span>`
    + `<span class="types">${breakdown}</span></li>`;
}).join('\n    ');

const html = `<title>Нарезка Москвы</title>
<style>
  :root {
    --ground: #f1f3f7; --panel: #ffffff; --ink: #171b22; --ink-soft: #5b6472;
    --line: #d8dde6; --warn: #b0431c; --metro: #a8b2c0;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #0e1116; --panel: #161a21; --ink: #e7ebf2; --ink-soft: #97a2b2;
      --line: #29303a; --warn: #e4784b; --metro: #444e60;
    }
  }
  :root[data-theme="dark"] {
    --ground: #0e1116; --panel: #161a21; --ink: #e7ebf2; --ink-soft: #97a2b2;
    --line: #29303a; --warn: #e4784b; --metro: #444e60;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font: 16px/1.55 -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 44px 24px 80px; display: flex; flex-direction: column; gap: 34px; }
  header { display: flex; flex-direction: column; gap: 12px; }
  .eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: var(--ink-soft); }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: clamp(30px, 4.4vw, 46px); margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
  .lede { margin: 0; max-width: 64ch; color: var(--ink-soft); }
  .figures { display: flex; flex-wrap: wrap; gap: 12px; }
  .fig { background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 14px 20px; min-width: 158px; }
  .fig b { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 30px; font-weight: 400; line-height: 1.15; }
  .fig span { font-size: 13px; color: var(--ink-soft); }
  .fig.alarm { border-color: var(--warn); }
  .fig.alarm b { color: var(--warn); }
  figure { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 3px; padding: 12px; }
  svg { width: 100%; height: auto; display: block; }
  .metro circle { fill: var(--metro); }
  .dot-out { fill: var(--metro); opacity: 0.8; }
  .labels text { font-family: Georgia, "Times New Roman", serif; font-size: 17px; font-weight: 700; fill: #fff; }
  .stations text { font-size: 10px; fill: var(--ink-soft); }
  svg.focused .sector:not(.on) polygon { fill-opacity: 0.04; stroke-opacity: 0.22; }
  svg.focused .sector:not(.on) circle { opacity: 0.14; }
  figcaption { color: var(--ink-soft); font-size: 13px; padding: 12px 4px 2px; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 3px; overflow: hidden; }
  li { display: grid; grid-template-columns: 10px 30px 1fr 58px; grid-template-areas: "sw num words count" ". . types types"; gap: 3px 12px; align-items: baseline; background: var(--panel); padding: 13px 16px; cursor: pointer; }
  li:hover, li:focus-visible, li.on { background: color-mix(in srgb, var(--panel) 87%, var(--ink)); outline: none; }
  .swatch { grid-area: sw; width: 10px; height: 10px; border-radius: 2px; align-self: center; }
  .num { grid-area: num; font-family: Georgia, "Times New Roman", serif; font-size: 18px; color: var(--ink-soft); }
  .words { grid-area: words; }
  .count { grid-area: count; text-align: right; font-family: Georgia, "Times New Roman", serif; font-size: 21px; }
  .types { grid-area: types; font-size: 12px; color: var(--ink-soft); }
  .ask { background: var(--panel); border: 1px solid var(--line); border-left: 3px solid var(--warn); border-radius: 3px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px; }
  .ask h2 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 23px; margin: 0; }
  .ask p { margin: 0; max-width: 68ch; }
  @media (max-width: 640px) {
    li { grid-template-columns: 10px 26px 1fr 50px; }
    .words { font-size: 14px; }
  }
</style>
<div class="wrap">
  <header>
    <span class="eyebrow">МИЛТИ · маршруты менеджеров · 18 августа 2026</span>
    <h1>Твои 14 секторов на карте</h1>
    <p class="lede">Границы нарисованы по твоим словам — значит, я мог понять их не так.
      Посмотри, где линия идёт не там, и скажи: подвину. Точки — объекты Базы, серые лежат
      вне всех секторов.</p>
  </header>

  <div class="figures">
    <div class="fig"><b>${inCount}</b><span>объектов внутри секторов</span></div>
    <div class="fig alarm"><b>${outside.length}</b><span>вне нарезки</span></div>
    <div class="fig alarm"><b>${days} дней</b><span>работы пятерых по 10 адресов</span></div>
    <div class="fig"><b>14</b><span>секторов</span></div>
  </div>

  <figure>
    ${svg}
    <figcaption>Мелкие серые точки — станции метро, для ориентира. Нажми на строку сектора, чтобы подсветить его на карте.</figcaption>
  </figure>

  <ol>
    ${cards}
  </ol>

  <div class="ask">
    <h2>Что мне нужно от тебя</h2>
    <p><b>Где граница проходит не там</b> — назови номер сектора и улицу, по которой должна
      идти линия. Я перерисую и пришлю карту заново.</p>
    <p>Серого на карте больше, чем цветного: в секторы попало ${inCount} объектов, вне нарезки
      осталось ${outside.length}. Это примерно ${days} рабочих дней на пятерых менеджеров —
      потом адреса в секторах кончатся. Что с этим делать — вопрос второй в списке.</p>
    <p><b>Остальные вопросы</b> — отдельной страницей, там же мои варианты ответов:
      <a href="https://claude.ai/code/artifact/1bf8787b-1024-4431-8943-19e3e6fda6cc">шесть вопросов</a>.</p>
  </div>
</div>
<script>
  const svgEl = document.querySelector('svg');
  const rows = [...document.querySelectorAll('li[data-sector]')];
  const groups = [...document.querySelectorAll('svg [data-sector]')];
  let current = null;
  function focus(id) {
    current = current === id ? null : id;
    svgEl.classList.toggle('focused', current !== null);
    for (const g of groups) g.classList.toggle('on', current === g.dataset.sector);
    for (const r of rows) r.classList.toggle('on', current === r.dataset.sector);
  }
  for (const r of rows) {
    r.addEventListener('click', () => focus(r.dataset.sector));
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(r.dataset.sector); }
    });
  }
</script>
`;

fs.writeFileSync('docs/для-Димы/карта-секторов.html', html);
console.log(`карта: ${html.length} символов | внутри ${inCount} | вне ${outside.length} | без координат ${noCoords} | дней ${days}`);
