/**
 * Адресный реестр Москвы — UNOM по кадастровому номеру.
 *
 * Источник: data.mos.ru, датасет 60562 «Адресный реестр объектов
 * недвижимости города Москвы», Департамент городского имущества.
 * Проверено 2026-07-16: 548 533 объекта, релиз обновляется ежедневно.
 *
 * Зачем он нужен: UNOM — стабильный государственный идентификатор здания.
 * Вычитание точек МИЛТИ идёт по точному совпадению UNOM, а не по строке
 * адреса («Пресненская наб., 6, стр. 2» и «Пресненская набережная 6с2» —
 * одно здание и две разные строки) и не по радиусу (радиус исключения
 * оказался бы больше радиуса обслуживания — см. спеку, раздел 5).
 *
 * Площади в этом датасете НЕТ — только адреса, UNOM и кадастровые номера.
 * Он нужен исключительно как ключ склейки.
 *
 * ЛИЦЕНЗИЯ: CC BY 4.0. Требуется ссылка на первоисточник — см. ATTRIBUTION.
 * Коммерческое использование разрешено.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DATASET_ID = 60562;
export const DATASET_META_URL = `https://data.mos.ru/api/v2/odata/datasets/${DATASET_ID}`;
export const CATALOG_URL = 'https://data.mos.ru/api/v2/odata/catalog/get';

export const ATTRIBUTION =
  'Источник: Портал открытых данных Правительства Москвы (data.mos.ru), ' +
  'датасет 60562 «Адресный реестр объектов недвижимости города Москвы». ' +
  'Лицензия CC BY 4.0.';

const PAGE_SIZE = 1000;

/**
 * Достать publicationCatalogId — он нужен для выгрузки и НЕ равен id датасета.
 *
 * Портал меняет его при каждой публикации новой версии, поэтому зашивать
 * константу нельзя. На 2026-07-16 это 29580, но проверяйте, а не верьте.
 */
export async function fetchCatalogId() {
  const response = await fetch(DATASET_META_URL);
  if (!response.ok) {
    throw new Error(`data.mos.ru отдал HTTP ${response.status} на паспорт датасета`);
  }
  const meta = await response.json();
  const catalogId = meta?.version?.publicationCatalogId;
  if (!catalogId) {
    throw new Error(
      'В паспорте датасета нет version.publicationCatalogId — портал изменил формат'
    );
  }
  return { catalogId, totalObjects: meta?.release?.cntObjects ?? null };
}

/**
 * Одна страница выгрузки.
 */
export async function fetchPage(catalogId, offset, limit = PAGE_SIZE) {
  const response = await fetch(CATALOG_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: catalogId, limit, offset }),
  });
  if (!response.ok) {
    throw new Error(`data.mos.ru отдал HTTP ${response.status} на выгрузку`);
  }
  const body = await response.json();
  if (body.status !== 0) {
    throw new Error(`data.mos.ru: ${body.message || 'неизвестная ошибка'}`);
  }
  return body.response || [];
}

/**
 * Скачать реестр и построить карту UNOM, НЕ накапливая строки в памяти.
 *
 * 548 533 объекта по 1000 на страницу = ~549 запросов. Если копить сами
 * строки, это гигабайты в куче и падение по памяти. Поэтому каждая
 * страница сворачивается в карту сразу и выбрасывается: остаётся только
 * ~500 тысяч пар «кадастровый номер -> UNOM».
 *
 * СКОЛЬКО ЖДАТЬ: ~50 минут, а не 15. Замерено 2026-07-16: страницы
 * деградируют с ростом смещения — offset 0 отдаётся за 2,3 с,
 * offset 400 000 за 10,2 с. Это классическая беда пагинации через OFFSET:
 * сервер сканирует с начала на каждом запросе. Прямой выгрузки файлом
 * у портала нет (эндпоинты /export отдают SPA-заглушку), так что
 * альтернативы нет. Операция разовая, повторяется раз в год — терпимо.
 * Не пытайтесь распараллелить: получите бан, а не ускорение.
 */
export async function buildUnomMapFromApi({ onProgress } = {}) {
  const { catalogId, totalObjects } = await fetchCatalogId();
  const map = new Map();
  let seen = 0;

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(catalogId, offset);
    const pageSize = page.length;
    if (pageSize === 0) break;

    seen += pageSize;
    for (const [cadastralNo, unom] of buildUnomMap(page)) {
      map.set(cadastralNo, unom);
    }
    page.length = 0; // не держим строки: 548 тыс. записей не влезут в кучу

    if (onProgress) onProgress(seen, totalObjects, map.size);

    // Выходим по короткой странице — это признак конца выдачи.
    // Счётчик totalObjects как страховка: он берётся из паспорта релиза
    // и может разойтись с фактом, если релиз обновится посреди выгрузки.
    if (pageSize < PAGE_SIZE) break;
    if (totalObjects && seen >= totalObjects) break;
  }

  return { map, seen, catalogId };
}

/**
 * Сохранить карту UNOM на диск как обычный объект.
 */
export async function saveUnomMap(map, destPath) {
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, JSON.stringify(Object.fromEntries(map)), 'utf8');
  return { path: destPath, count: map.size };
}

/**
 * Построить отображение кадастровый номер -> UNOM.
 *
 * ВНИМАНИЕ на структуру, она неочевидна и проверена на живых данных:
 *   KAD_N — это НЕ строка и НЕ массив строк, а массив объектов:
 *   [{ global_id, is_deleted, KAD_N: "77:03:0007004:1064" }]
 *
 * У одного здания может быть несколько кадастровых номеров; у одного
 * кадастрового номера — один UNOM. Удалённые записи (is_deleted) и
 * кадастровые номера земельных участков (KAD_ZU) игнорируем: участок —
 * не здание, его UNOM нам не нужен.
 *
 * @param {Array<object>} rows
 * @returns {Map<string, number>}
 */
export function buildUnomMap(rows) {
  const map = new Map();

  for (const row of rows) {
    if (row?.is_deleted) continue;
    const unom = Number(row?.UNOM);
    if (!Number.isFinite(unom) || unom === 0) continue;

    for (const entry of row.KAD_N || []) {
      if (entry?.is_deleted) continue;
      const cadastralNo = String(entry?.KAD_N || '').trim();
      if (cadastralNo) map.set(cadastralNo, unom);
    }
  }

  return map;
}

export async function loadUnomMap(path) {
  return buildUnomMap(JSON.parse(await readFile(path, 'utf8')));
}
