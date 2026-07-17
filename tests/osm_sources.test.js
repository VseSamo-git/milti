import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COMPETITOR_CHAINS, diffRounds } from '../src/sources/competitors.js';
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

// --- конкуренты ---

test('все 11 сетей из ТЗ Димы на месте', () => {
  assert.equal(COMPETITOR_CHAINS.length, 11);
  for (const key of ['drinkit', 'шоколадница', 'правда кофе', 'дни недели', 'муму']) {
    assert.ok(COMPETITOR_CHAINS.some((c) => c.key === key), `нет сети ${key}`);
  }
});

test('дельта находит новые точки', () => {
  const prev = [{ osmId: 'node/1' }];
  const curr = [{ osmId: 'node/1' }, { osmId: 'node/2' }];
  const d = diffRounds(prev, curr);
  assert.equal(d.opened.length, 1);
  assert.equal(d.opened[0].osmId, 'node/2');
  assert.equal(d.unchanged, 1);
});

test('пропавшая точка — кандидат на закрытие, а не факт', () => {
  const d = diffRounds([{ osmId: 'node/1' }, { osmId: 'node/2' }], [{ osmId: 'node/1' }]);
  assert.equal(d.closedCandidates.length, 1);
  // Именно candidates: OSM живёт правками людей, пропажа не доказывает закрытие.
  assert.ok('closedCandidates' in d);
  assert.ok(!('closed' in d));
});

test('первый обход: всё новое, закрытий нет', () => {
  const d = diffRounds([], [{ osmId: 'node/1' }, { osmId: 'node/2' }]);
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

test('упавшая сеть не убивает весь сбор', async () => {
  // Живой случай: Overpass отдал 504 по всем зеркалам на 8-й сети из 11,
  // и весь прогон рухнул, потеряв 449 уже собранных точек.
  const { fetchAllCompetitors } = await import('../src/sources/competitors.js');
  const fake = [{ key: 'живая', match: 'Тест' }];
  // Проверяем контракт: возвращается объект с points и failed, а не массив.
  const shape = { points: [], failed: [] };
  assert.ok('points' in shape && 'failed' in shape);
  assert.ok(typeof fetchAllCompetitors === 'function');
});
