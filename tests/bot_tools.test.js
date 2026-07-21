import test from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnlySelect, recordVerdict, VERDICTS } from '../src/bot/tools.js';

// --- ГЛАВНЫЙ ГАРД: read-only. Тест, который держит боевую базу живой ---

test('пропускает обычный SELECT', () => {
  assert.equal(isReadOnlySelect('SELECT * FROM "1 БЦ Москвы"').ok, true);
  assert.equal(isReadOnlySelect('  select "Адрес" from "7 Конкуренты"  ').ok, true);
});

test('пропускает WITH (CTE тоже читает)', () => {
  assert.equal(isReadOnlySelect('WITH t AS (SELECT 1) SELECT * FROM t').ok, true);
});

test('терпит одну завершающую точку с запятой', () => {
  assert.equal(isReadOnlySelect('SELECT 1;').ok, true);
});

test('РЕЖЕТ всё пишущее и структурное', () => {
  for (const q of [
    'DELETE FROM kosmos.objects',
    'UPDATE kosmos.objects SET area_sqm = 0',
    'INSERT INTO kosmos.verdicts VALUES (1)',
    'DROP TABLE kosmos.objects',
    'TRUNCATE kosmos.places',
    'ALTER TABLE kosmos.objects ADD COLUMN x int',
    'GRANT ALL ON kosmos.objects TO public',
  ]) {
    assert.equal(isReadOnlySelect(q).ok, false, `должен был отклонить: ${q}`);
  }
});

test('РЕЖЕТ вторую команду за точкой с запятой', () => {
  const r = isReadOnlySelect('SELECT 1; DROP TABLE kosmos.objects');
  assert.equal(r.ok, false);
  assert.match(r.reason, /несколько команд/);
});

test('РЕЖЕТ комментарии (за -- прячут вторую строку)', () => {
  assert.equal(isReadOnlySelect('SELECT 1 -- потом что-то').ok, false);
  assert.equal(isReadOnlySelect('SELECT 1 /* */ ').ok, false);
});

test('РЕЖЕТ не-SELECT', () => {
  assert.equal(isReadOnlySelect('SET search_path TO public').ok, false);
  assert.equal(isReadOnlySelect('').ok, false);
  assert.equal(isReadOnlySelect(null).ok, false);
});

test('НЕ ловит create внутри имени столбца created_at', () => {
  // Граница слова: created_at не должен читаться как create.
  assert.equal(isReadOnlySelect('SELECT created_at FROM t').ok, true);
  assert.equal(isReadOnlySelect('SELECT updated_by FROM t').ok, true);
});

// --- ЗАПИСЬ: только валидные вердикты, и только через verdicts ---

test('recordVerdict отвергает неизвестный вердикт ДО обращения к базе', async () => {
  // Реестр-заглушка: если до него дойдёт, тест провалится по «not a function».
  const stub = { sql: () => { throw new Error('база не должна была вызваться'); } };
  await assert.rejects(
    () => recordVerdict(stub, { cadastralNo: '77:01:0', verdict: 'снести_здание', author: 'x' }),
    /неизвестный вердикт/
  );
});

test('recordVerdict требует кадастр и автора', async () => {
  const stub = { sql: () => { throw new Error('рано'); } };
  await assert.rejects(() => recordVerdict(stub, { verdict: 'интересно', author: 'x' }), /кадастр/);
  await assert.rejects(
    () => recordVerdict(stub, { cadastralNo: '77:01:0', verdict: 'интересно' }),
    /автор/
  );
});

test('набор вердиктов совпадает со схемой', () => {
  assert.deepEqual(VERDICTS, ['интересно', 'не_наш_формат', 'проверить', 'отказ']);
});
