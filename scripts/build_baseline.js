/**
 * Разовая сборка реестра КОСМОС.
 *
 * Порядок этапов — не произвол, а суть проекта. Обогащение идёт ПОСЛЕ
 * фильтра по площади, поэтому дорогой шаг применяется к ~3 400 объектам,
 * а не к 42 000. Обратный порядок сделал бы проект неподъёмным.
 *
 *   1. parse    — перечень 700-ПП -> 42 650 кадастровых номеров   (минуты)
 *   2. enrich   — НСПД по зданиям -> площадь                       (~40 часов)
 *   3. unom     — адресный реестр -> UNOM для склейки              (минуты)
 *   4. subtract — вычитание точек МИЛТИ по UNOM                    (секунды)
 *
 * Сорок часов — это разово. Перечень 700-ПП меняется раз в квартал, поэтому
 * воскресный цикл спрашивает НСПД только про новые объекты — это минуты.
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
import { withRetry } from '../src/lib/retry.js';
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

  // Прогноз считаем по ИЗМЕРЕННОМУ темпу, а не по лимиту 1 req/s.
  // Раньше здесь стояло «~6,4 ч при 1 req/s» — расчёт от нашего же лимита.
  // Замер показал 6,7 с на объект: НСПД отвечает от 0,3 до 12 с и тем
  // медленнее, чем дольше его просят. Троттл при этом ни разу не сработал
  // (простой 5 мс на 8 запросов) — узкое место снаружи, а не у нас.
  // Ускорять нечем: параллель лимит не обходит, на подборе формата
  // bulk-эндпоинта прилетел 429. Цифра честная — 40 часов, не 6.
  const startedAt = Date.now();

  let enriched = 0;
  let failed = 0;

  // Предохранитель от бана. 403 у НСПД — это WAF режет наш IP по правилу,
  // а не разовый сбой. Продолжать долбить забаненный портал бессмысленно
  // и вредно: серия запросов только углубляет бан (проверено болью —
  // домашний IP 192.144.14.117 словил бан правилом WAF после того, как
  // прогон грыз 403 во время сетевого блипа). Поэтому N подряд 403 → обрыв.
  const FORBIDDEN_LIMIT = 5;
  let consecutive403 = 0;
  let bannedAbort = false;

  for (const [index, cadastralNo] of pending.entries()) {
    // Весь корпус объекта под защитой: ни сбой НСПД, ни обрыв базы не
    // должны убить 40-часовой прогон. Упавший объект остаётся с
    // area_source IS NULL и подхватится следующим запуском — прогон
    // возобновляемый. Проверено болью: незащищённая запись в базу
    // уронила прогон на 1461-м объекте по ECONNRESET.
    try {
      // Сетевые шаги — с повтором: и запрос к НСПД, и записи в облачную
      // базу переживают короткий блип, а не роняют всё.
      const payload = await withRetry(() => client.fetchRaw(cadastralNo));
      consecutive403 = 0; // дошли до ответа — IP не забанен
      if (payload === null) continue;

      await withRetry(() => registry.recordObservation({ source: 'nspd', cadastralNo, payload }));

      const record = client.parse(payload);
      if (record !== null) {
        await withRetry(() => registry.applyNspd(cadastralNo, record));
        enriched += 1;
      }
    } catch (error) {
      failed += 1;
      if (/\b403\b/.test(error.message || '')) {
        consecutive403 += 1;
        if (consecutive403 >= FORBIDDEN_LIMIT) {
          console.error(
            `\nНСПД банит наш IP: ${consecutive403} подряд 403. Обрываю прогон, ` +
              `чтобы не углублять бан. Смени IP (сервер/VPN) или переждни снятие бана, ` +
              `затем перезапусти — прогон возобновляемый (пройденные пропускаются).`
          );
          bannedAbort = true;
          break;
        }
      } else {
        consecutive403 = 0;
      }
      console.error(`[${index + 1}/${pending.length}] ${cadastralNo}: ${error.message}`);
      continue;
    }

    if ((index + 1) % 500 === 0) {
      const secPer = (Date.now() - startedAt) / 1000 / (index + 1);
      const leftH = ((pending.length - index - 1) * secPer) / 3600;
      console.log(
        `[${index + 1}/${pending.length}] обогащено ${enriched}, ошибок ${failed}, ` +
          `${secPer.toFixed(1)} с/объект, осталось ~${leftH.toFixed(1)} ч`
      );
    }
  }

  console.log(`обогащено: ${enriched}, ошибок: ${failed}`);
  // Ненулевой код выхода при бане: чтобы фон/оркестратор не счёл прогон
  // успешным и не пошёл дальше по конвейеру на неполных данных.
  if (bannedAbort) process.exitCode = 3;
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
  console.log(`адресный реестр: обновлено ${applied} строк (UNOM и/или координаты)`);
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
