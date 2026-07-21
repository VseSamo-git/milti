import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPETITOR_CHAINS, diffRounds, checkCoverage, fetchAllCompetitors } from '../src/sources/competitors.js';
import { isResearchInstitute } from '../src/sources/education.js';
import { MOSCOW_BBOX, bboxString, parseElements } from '../src/lib/overpass.js';

// --- overpass ---

test('bbox Москвы включает Зеленоград по широте', () => {
  assert.ok(MOSCOW_BBOX.north >= 55.9); // Зеленоград ~55.99 по центру, край входит
  assert.equal(bboxString(), '55.55,37.35,55.92,37.85');
});

test('node отдаёт координаты напрямую, way — через center', () => {
  const payload = {
    elements: [
      { type: 'node', id: 1, lat: 55.7, lon: 37.6, tags: { name: 'А' } },
      { type: 'way', id: 2, center: { lat: 55.8, lon: 37.5 }, tags: { name: 'Б' } },
    ],
  };
  const [a, b] = parseElements(payload);
  assert.equal(a.lat, 55.7);
  assert.equal(b.lat, 55.8);
  assert.equal(b.osmId, 'way/2');
});

test('элемент без координат пропускается: точка без места бесполезна', () => {
  assert.equal(parseElements({ elements: [{ type: 'node', id: 1, tags: { name: 'X' } }] }).length, 0);
});

// --- конкуренты: store-locator'ы ---

test('подключённые сети имеют ключ и первоисточник', () => {
  // Собираем со store-locator'ов сетей; 3 сети (drinkit/здрасте/parle) за
  // анти-ботом и подключаются отдельно — здесь только те, что реально собираем.
  assert.ok(COMPETITOR_CHAINS.length >= 7, `сетей мало: ${COMPETITOR_CHAINS.length}`);
  for (const key of ['шоколадница', 'правда кофе', 'french bakery', 'братья караваевы']) {
    assert.ok(COMPETITOR_CHAINS.some((c) => c.key === key), `нет сети ${key}`);
  }
  // У каждой сети должен быть домен-первоисточник (провенанс).
  for (const c of COMPETITOR_CHAINS) assert.ok(c.source, `у ${c.key} нет source`);
});

// --- КАНАРЕЙКА: тест, которого не было и который поймал бы «6 вместо 154» ---

test('канарейка: мало точек относительно заявленного — парсер сломан', () => {
  assert.equal(checkCoverage(6, 154).status, 'broken'); // French Bakery в OSM: 4%
  assert.equal(checkCoverage(0, 100).status, 'broken'); // ничего не отдал
  assert.equal(checkCoverage(95, 100).status, 'ok'); // 95% — норма
  assert.equal(checkCoverage(79, 79).status, 'ok'); // сайт сам сказал 79
  assert.equal(checkCoverage(78, null, 70).status, 'estimate'); // сверка с оценкой
});

test('вторичный источник (OSM) неполон — это partial, а НЕ broken', () => {
  // drinkit: 47 из ~116 (40%). Для store-locator'а это «сломан», для OSM — норма.
  assert.equal(checkCoverage(47, null, 116, 'secondary').status, 'partial');
  assert.equal(checkCoverage(3, null, 24, 'secondary').status, 'partial'); // parle 12%
  // Но пустой ответ — всё равно поломка: источник не отдал ничего.
  assert.equal(checkCoverage(0, null, 116, 'secondary').status, 'broken');
  // Тот же расклад для первички остаётся broken — режимы не перепутаны.
  assert.equal(checkCoverage(47, null, 116, 'primary').status, 'broken');
});

test('вторичная сеть: точки пишутся, помечены low, в failed НЕ уходит', async () => {
  const adapters = [
    {
      chain: 'вторичная',
      source: 'osm_secondary',
      confidence: 'low',
      kind: 'secondary',
      expectedMin: 100,
      async fetch() {
        // 20 из 100 — для OSM ожидаемая неполнота
        return { stated: null, raw: Array.from({ length: 20 }, (_, i) => ({
          id: `node/${i}`, name: `т${i}`, address: 'Москва', lat: 55.75, lon: 37.6,
        })) };
      },
    },
  ];
  const { points, failed, coverage } = await fetchAllCompetitors({ adapters });
  assert.equal(failed.length, 0, 'вторичная неполнота — не failed');
  assert.equal(points.length, 20, 'собранные точки пишутся');
  assert.ok(points.every((p) => p.confidence === 'low'), 'вторичные помечены low');
  assert.equal(coverage[0].status, 'partial');
});

test('сломанная сеть уходит в failed и НЕ пишется в базу', async () => {
  const adapters = [
    {
      chain: 'здоровая',
      source: 'ok.ru',
      // 95 из 100 заявленных — норма
      async fetch() {
        return { stated: 100, raw: pts(95) };
      },
    },
    {
      chain: 'битая',
      source: 'bad.ru',
      // 6 из 154 — ровно провал French Bakery в OSM
      async fetch() {
        return { stated: 154, raw: pts(6) };
      },
    },
  ];
  const { points, failed } = await fetchAllCompetitors({ adapters });

  // Битая сеть — в failed, её точек в результате НЕТ (молчаливый ноль невозможен).
  assert.ok(failed.some((f) => f.chain === 'битая'), 'битая сеть должна попасть в failed');
  assert.equal(points.filter((p) => p.chain === 'битая').length, 0);
  // Здоровая — собрана.
  assert.ok(points.some((p) => p.chain === 'здоровая'));

  function pts(n) {
    return Array.from({ length: n }, (_, i) => ({
      id: i,
      name: `т${i}`,
      address: 'г. Москва, тест',
      lat: 55.75,
      lon: 37.6,
    }));
  }
});

test('дельта находит новые точки (по place_key)', () => {
  const prev = [{ placeKey: 'shoko:1' }];
  const curr = [{ placeKey: 'shoko:1' }, { placeKey: 'shoko:2' }];
  const d = diffRounds(prev, curr);
  assert.equal(d.opened.length, 1);
  assert.equal(d.opened[0].placeKey, 'shoko:2');
  assert.equal(d.unchanged, 1);
});

test('пропавшая точка — кандидат на закрытие, а не факт', () => {
  const d = diffRounds([{ placeKey: 'a' }, { placeKey: 'b' }], [{ placeKey: 'a' }]);
  assert.equal(d.closedCandidates.length, 1);
  assert.ok('closedCandidates' in d);
  assert.ok(!('closed' in d));
});

test('первый обход: всё новое, закрытий нет', () => {
  const d = diffRounds([], [{ placeKey: 'a' }, { placeKey: 'b' }]);
  assert.equal(d.opened.length, 2);
  assert.equal(d.closedCandidates.length, 0);
});

// --- ВУЗы и НИИ ---

test('office=research — это НИИ без разговоров', () => {
  assert.equal(isResearchInstitute(null, { office: 'research' }), true);
});

test('распознаёт НИИ по названию', () => {
  assert.equal(isResearchInstitute('ЦНИИТМАШ'), true);
  assert.equal(isResearchInstitute('НИИ МЧС России'), true);
  assert.equal(isResearchInstitute('Научно-исследовательский институт стали'), true);
  // Живые примеры из OSM: аббревиатура слитно с именем.
  assert.equal(isResearchInstitute('ЦНИИТМАШ'), true);
  assert.equal(isResearchInstitute('ВНИИГаз'), true);
});

test('отсеивает ложное срабатывание регэкспа', () => {
  // Живой пример из выдачи Overpass: регэксп по «НИИ» поймал памятник.
  assert.equal(isResearchInstitute('Св. князю Даниилу'), false);
  assert.equal(isResearchInstitute('Храм Николая Чудотворца'), false);
});

test('пустое имя — не НИИ', () => {
  assert.equal(isResearchInstitute(null), false);
  assert.equal(isResearchInstitute(''), false);
});

// --- устойчивость сбора ---

test('упавший адаптер не убивает весь сбор', async () => {
  const adapters = [
    { chain: 'падает', source: 'x', async fetch() { throw new Error('сеть недоступна'); } },
    { chain: 'живёт', source: 'y', async fetch() {
      return { stated: 3, raw: [{ id: 1, name: 'a', address: 'Москва', lat: 55.75, lon: 37.6 },
        { id: 2, name: 'b', address: 'Москва', lat: 55.75, lon: 37.6 },
        { id: 3, name: 'c', address: 'Москва', lat: 55.75, lon: 37.6 }] };
    } },
  ];
  const { points, failed } = await fetchAllCompetitors({ adapters });
  assert.ok(failed.some((f) => f.chain === 'падает'));
  assert.equal(points.filter((p) => p.chain === 'живёт').length, 3); // сбор продолжился
});
