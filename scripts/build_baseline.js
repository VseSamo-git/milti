/**
 * Разовая сборка реестра КОСМОС.
 *
 * Порядок этапов — не произвол, а суть проекта. Обогащение идёт ПОСЛЕ
 * фильтра по площади, поэтому дорогой шаг применяется к ~3 400 объектам,
 * а не к 42 000. Обратный порядок сделал бы проект неподъёмным.
 *
 *   1. parse    — перечень 700-ПП -> 42 650 кадастровых номеров   (минуты)
 *   2. enrich   — НСПД по зданиям -> площадь                       (~6,4 часа)
 *   3. unom     — адресный реестр -> UNOM для склейки              (минуты)
 *   4. subtract — вычитание точек МИЛТИ по UNOM                    (секунды)
 *
 * Скрипт ВОЗОБНОВЛЯЕМЫЙ: часы работы нельзя терять из-за одного таймаута.
 * Повторный запуск enrich продолжит с места обрыва.
 *
 * Запуск:
 *   node scripts/build_baseline.js all
 *   node scripts/build_baseline.js enrich   # продолжить после сбоя
 *
 * Требует переменных окружения:
 *   KOSMOS_DB_URL     — строка подключения к Postgres
 *   NODE_EXTRA_CA_CERTS=certs/ru-bundle.pem — иначе НСПД не отдаст TLS
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { loadConfig } from '../src/config.js';
import { Registry, SOURCE_PP700 } from '../src/lib/registry.js';
import { selfcheck, subtractOurPoints } from '../src/lib/subtract.js';
import { ATTRIBUTION, buildUnomMapFromApi, saveUnomMap } from '../src/sources/addr_registry.js';
import { NspdClient } from '../src/sources/nspd.js';
import { PP700_2026_URL, download, parseFile } from '../src/sources/pp700.js';

const PDF_PATH = 'data/pp700-2026.pdf';
const UNOM_PATH = 'data/unom_map.json';

/**
 * Приложение 1 — здания, приложение 2 — помещения.
 *
 * Обогащаем только приложение 1: у помещений НСПД отдаёт площадь КОМНАТЫ,
 * а не здания (проверено: 13,6-621,2 м² в выборке), они заведомо не пройдут
 * фильтр 10 000 м². 19 480 запросов к ним — 5,4 часа впустую.
 *
 * Приложение определяется позицией номера в перечне: первым идёт
 * приложение 1, затем приложение 2. Разделяем по границе.
 */
function splitByAnnex(cadastrals, annex1Count) {
  return cadastrals.map((cadastralNo, index) => ({
    cadastralNo,
    annex: index < annex1Count ? 1 : 2,
  }));
}

async function stageParse(registry) {
  if (!existsSync(PDF_PATH)) {
    console.log('качаю перечень 700-ПП...');
    await download(PP700_2026_URL, PDF_PATH);
  }

  const cadastrals = await parseFile(PDF_PATH);
  console.log(`разобрано кадастровых номеров: ${cadastrals.length}`);

  // Границу приложений определяем по факту: в редакции 2026 года
  // приложение 1 — 22 863 здания. Если структура перечня изменится,
  // это надо пересчитать.
  const ANNEX_1_COUNT = 22_863;
  const entries = splitByAnnex(cadastrals, ANNEX_1_COUNT);

  const affected = await registry.upsertFromPp700(entries);
  await registry.recordObservation({
    source: SOURCE_PP700,
    payload: { total: cadastrals.length, annex1: ANNEX_1_COUNT },
    sourceUrl: PP700_2026_URL,
  });

  console.log(`загружено в реестр: ${affected}`);
  return affected;
}

async function stageEnrich(registry, cfg) {
  const client = new NspdClient(cfg);
  const pending = await registry.pendingCadastrals();
  console.log(`к обогащению (только здания): ${pending.length}`);
  console.log(`ожидаемое время: ~${(pending.length / 3600).toFixed(1)} ч при 1 req/s`);

  let enriched = 0;
  let failed = 0;

  for (const [index, cadastralNo] of pending.entries()) {
    let payload;
    try {
      payload = await client.fetchRaw(cadastralNo);
    } catch (error) {
      failed += 1;
      console.error(`[${index + 1}/${pending.length}] ${cadastralNo}: ${error.message}`);
      continue;
    }

    if (payload === null) continue;

    await registry.recordObservation({ source: 'nspd', cadastralNo, payload });

    const record = client.parse(payload);
    if (record !== null) {
      await registry.applyNspd(cadastralNo, record);
      enriched += 1;
    }

    if ((index + 1) % 500 === 0) {
      console.log(`[${index + 1}/${pending.length}] обогащено ${enriched}, ошибок ${failed}`);
    }
  }

  console.log(`обогащено: ${enriched}, ошибок: ${failed}`);
}

async function stageUnom(registry) {
  let unomMap;

  if (existsSync(UNOM_PATH)) {
    unomMap = JSON.parse(await readFile(UNOM_PATH, 'utf8'));
    console.log(`карта UNOM из файла: ${Object.keys(unomMap).length} пар`);
  } else {
    console.log('качаю адресный реестр...');
    const { map } = await buildUnomMapFromApi({
      onProgress(seen, total) {
        if (seen % 100_000 === 0) console.log(`  ${seen}/${total}`);
      },
    });
    await saveUnomMap(map, UNOM_PATH);
    unomMap = Object.fromEntries(map);
  }

  const applied = await registry.applyUnomMap(unomMap);
  console.log(`UNOM проставлен: ${applied} строк`);
  console.log(ATTRIBUTION);

  // Порог считаем ТОЛЬКО по зданиям приложения 1. У помещений приложения 2
  // номер комнаты, а карта UNOM — про здания: их покрытие ~1% по построению.
  // Проверено на живых данных: здания — 92%, помещения — 1%, агрегат — 49%.
  const { buildings, withUnom } = await registry.unomCoverageBuildings();
  const coverage = buildings ? withUnom / buildings : 0;
  console.log(`покрытие зданий UNOM: ${withUnom}/${buildings} (${(100 * coverage).toFixed(0)}%)`);

  if (coverage < 0.5) {
    throw new Error(
      `UNOM склеился только для ${(100 * coverage).toFixed(0)}% зданий. ` +
        'Вычитание точек будет дырявым — разберитесь до запуска subtract.'
    );
  }
}

async function stageSubtract(registry) {
  const collisions = await selfcheck(registry);
  if (collisions.length > 0) {
    throw new Error(
      `Регресс-тест провален: ${collisions.length} пар наших точек исключают ` +
        `друг друга, например ${JSON.stringify(collisions[0])}. ` +
        'Правило вычитания неверно по построению — не запускайте сборку.'
    );
  }

  const { subtracted, unresolved } = await subtractOurPoints(registry);
  console.log(`вычтено: ${subtracted}, нерезолвленных точек: ${unresolved}`);

  if (unresolved > 0) {
    console.log(
      `ВНИМАНИЕ: ${unresolved} точек МИЛТИ без UNOM — они НЕ вычтены. ` +
        'Дима увидит их объекты как лиды. Разрезолвьте адреса.'
    );
  }
}

async function main() {
  const stage = process.argv[2] || 'all';
  const cfg = loadConfig();
  const registry = new Registry(cfg);

  try {
    if (stage === 'parse' || stage === 'all') await stageParse(registry);
    if (stage === 'enrich' || stage === 'all') await stageEnrich(registry, cfg);
    if (stage === 'unom' || stage === 'all') await stageUnom(registry);
    if (stage === 'subtract' || stage === 'all') await stageSubtract(registry);

    if (stage === 'all') {
      await registry.markBaselineComplete();
      console.log('baseline снят: дальше новое подсвечивается как новое');
    }
  } finally {
    await registry.close();
  }
}

await main();
