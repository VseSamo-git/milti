import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isTransient, withRetry } from '../src/lib/retry.js';

test('withRetry возвращает результат с первой попытки без задержек', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls += 1;
    return 'ок';
  });
  assert.equal(result, 'ок');
  assert.equal(calls, 1);
});

test('withRetry повторяет временную ошибку и добивается успеха', async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        const err = new Error('read ECONNRESET');
        err.code = 'ECONNRESET';
        throw err;
      }
      return 'ожил';
    },
    { attempts: 3, sleep: async () => {} }
  );
  assert.equal(result, 'ожил');
  assert.equal(calls, 3);
});

test('withRetry сдаётся после исчерпания попыток и отдаёт последнюю ошибку', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          const err = new Error('read ECONNRESET');
          err.code = 'ECONNRESET';
          throw err;
        },
        { attempts: 3, sleep: async () => {} }
      ),
    /ECONNRESET/
  );
  // attempts=3 -> ровно 3 попытки, не бесконечный цикл
  assert.equal(calls, 3);
});

test('withRetry НЕ повторяет постоянную ошибку — падает сразу', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1;
          throw new Error('CHECK constraint area_needs_source нарушен');
        },
        { attempts: 5, sleep: async () => {} }
      ),
    /CHECK constraint/
  );
  // Логическая ошибка не лечится повтором: одна попытка, а не пять.
  assert.equal(calls, 1);
});

test('isTransient распознаёт сетевые обрывы и пропускает логические ошибки', () => {
  const econnreset = new Error('read ECONNRESET');
  econnreset.code = 'ECONNRESET';
  assert.equal(isTransient(econnreset), true);

  assert.equal(isTransient(new Error('fetch failed')), true);
  assert.equal(isTransient(new Error('Connection terminated unexpectedly')), true);

  const etimedout = new Error('timeout');
  etimedout.code = 'ETIMEDOUT';
  assert.equal(isTransient(etimedout), true);

  // Не сетевое — не лечится повтором.
  assert.equal(isTransient(new Error('duplicate key value violates unique constraint')), false);
  assert.equal(isTransient(new Error('НСПД отдал 403')), false);
});

test('isTransient считает шлюзовые HTTP-статусы временными', () => {
  // Портал data.mos.ru под fetchGeodata изредка отдаёт 504/503 — это
  // перегрузка шлюза, лечится повтором. Формат сообщения — как у fetchPage.
  assert.equal(isTransient(new Error('data.mos.ru отдал HTTP 504 на выгрузку')), true);
  assert.equal(isTransient(new Error('data.mos.ru отдал HTTP 503 на выгрузку')), true);
  assert.equal(isTransient(new Error('data.mos.ru отдал HTTP 502 на выгрузку')), true);
  assert.equal(isTransient(new Error('data.mos.ru отдал HTTP 429 на выгрузку')), true);
});

test('isTransient НЕ повторяет клиентские HTTP-ошибки (4xx кроме 429)', () => {
  // 400/404 — наша вина (кривой запрос), повтор не поможет, падаем сразу.
  assert.equal(isTransient(new Error('data.mos.ru отдал HTTP 400 на выгрузку')), false);
  assert.equal(isTransient(new Error('data.mos.ru отдал HTTP 404 на выгрузку')), false);
});

test('HTTP 502 от NocoDB считается временным — раньше эта ветка была мёртвой', async () => {
  // Проверка ответа стояла СНАРУЖИ withRetry, а fetch на 502 не бросает —
  // он возвращает ответ. Поэтому 429/500/502/503/504 никогда не доходили
  // до isTransient, и рестарт контейнера NocoDB убивал пересборку витрины.
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error('NocoDB GET /api/v2/tables/x/records: HTTP 502 Bad Gateway');
      return 'готово';
    },
    { attempts: 4, backoffMs: 1, sleep: async () => {} }
  );
  assert.equal(result, 'готово');
  assert.equal(calls, 3);
});

test('пометка noRetry запрещает повтор даже сетевой ошибки', async () => {
  // Так помечены записи в NocoDB: ответ мог потеряться уже ПОСЛЕ вставки,
  // и повтор продублировал бы строки в листе Димы.
  let calls = 0;
  const error = Object.assign(new Error('fetch failed'), { noRetry: true });
  await assert.rejects(
    () => withRetry(async () => { calls++; throw error; }, { attempts: 4, backoffMs: 1, sleep: async () => {} }),
    /fetch failed/
  );
  assert.equal(calls, 1, 'запись повторять нельзя');
});
