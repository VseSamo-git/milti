/**
 * Перечень 700-ПП — состав коммерческой недвижимости Москвы.
 *
 * Источник: Постановление Правительства Москвы N 700-ПП от 28.11.2014.
 * Базовое постановление НЕ переиздаётся — ежегодно выходит новое,
 * излагающее приложения в новой редакции. На 2026 год — 2794-ПП от 19.11.2025,
 * с правкой 863-ПП от 31.03.2026.
 *
 * Критерий включения — это буквально требование Димы «функционирует как БЦ»:
 * объект попадает в перечень, если участок под ним имеет офисно-торговый ВРИ,
 * ЛИБО если Госинспекция по недвижимости актом установила, что не менее 20%
 * площади фактически занято офисами, торговлей, бытовым обслуживанием
 * или общепитом.
 *
 * В перечне ровно четыре колонки: N п/п, кадастровый номер здания,
 * кадастровый номер помещения, адрес. ПЛОЩАДИ В НЁМ НЕТ — проверено
 * полнотекстовым поиском: слово «площадь» встречается 6 раз и все 6 —
 * названия улиц. Не пытайтесь её там найти.
 *
 * Лицензия: нормативный правовой акт, п. 5 ст. 1259 ГК — не объект
 * авторских прав. Использование, включая коммерческое, свободно.
 */
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { inflateSync } from 'node:zlib';

import { BROWSER_UA } from '../config.js';

export const PP700_2026_URL =
  'https://www.mos.ru/upload/documents/docs/5318/2794-PP-svfo1.pdf';
export const PP700_2026_AMENDMENT_URL =
  'https://www.mos.ru/upload/documents/files/7455/PPMot31032026863-PP.pdf';

// Кадастровый номер: 77:01:0001075:2898. Округ 50 — это Зеленоград и ТиНАО,
// исторически зарегистрированные в Московской области. Разведка нашла там
// 866 объектов. Не отбрасывайте их как «не Москву».
const CADASTRAL_RE = /\d{2}:\d{2}:\d{6,7}:\d+/g;

// Литерал PDF: (текст) с учётом экранирования.
const LITERAL_RE = /\(((?:\\.|[^\\()])*)\)/g;

// Приёмочные границы. Разведка 2026-07-16 дала 42 650.
export const EXPECTED_MIN = 42_000;
export const EXPECTED_MAX = 42_700;

/**
 * Скачать PDF перечня. Требует браузерный User-Agent, иначе mos.ru даёт 403.
 */
export async function download(url, destPath) {
  await mkdir(dirname(destPath), { recursive: true });
  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`mos.ru отдал HTTP ${response.status} на ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
  return destPath;
}

/**
 * Извлечь текст из PDF без внешних библиотек.
 *
 * ЧИТАЙТЕ ЭТО, ПРЕЖДЕ ЧЕМ «УПРОЩАТЬ». Автор провалился здесь дважды.
 *
 * Устройство файла:
 *   1. Subset-шрифты с собственной кодировкой глифов. Кириллица (адреса)
 *      лежит НЕ текстом, а номерами глифов: [<00010002>-3<0003...>]TJ.
 *      Без таблицы ToUnicode это не декодировать — и не надо: адрес мы
 *      берём из НСПД (поле readable_address), он там чище.
 *   2. Цифры и латиница — открытым текстом в литералах (...).
 *      Кадастровые номера состоят из цифр и двоеточий, значит извлекаемы.
 *   3. ГЛАВНАЯ ЛОВУШКА: кернинг режет числа на куски. Номер
 *      50:09:0000000:179835 лежит как (50:09) (:0000) (000:1) (79835)
 *      с кернинг-числами между ними.
 *
 * Поэтому: склеиваем ВСЕ литералы потока подряд, без разделителей.
 * Кернинг-числа и hex-глифы при этом просто выпадают, а разорванные
 * номера срастаются.
 *
 * Наивная регулярка по сырому потоку возвращает НОЛЬ. Молча, без ошибки.
 */
export function extractText(pdfBuffer) {
  let joined = '';
  let pos = 0;

  for (;;) {
    const start = pdfBuffer.indexOf('stream', pos);
    if (start === -1) break;
    const end = pdfBuffer.indexOf('endstream', start);
    if (end === -1) break;

    let dataStart = start + 'stream'.length;
    while (pdfBuffer[dataStart] === 0x0d || pdfBuffer[dataStart] === 0x0a) {
      dataStart += 1;
    }

    try {
      const raw = inflateSync(pdfBuffer.subarray(dataStart, end)).toString('latin1');
      if (raw.includes('Tj') || raw.includes('TJ')) {
        let match;
        LITERAL_RE.lastIndex = 0;
        while ((match = LITERAL_RE.exec(raw)) !== null) {
          joined += match[1];
        }
        joined += '\n';
      }
    } catch {
      // не FlateDecode или не текстовый поток — пропускаем
    }

    pos = end + 'endstream'.length;
  }

  return joined;
}

/**
 * Кадастровые номера перечня, в порядке появления, без дубликатов.
 */
export function parseCadastrals(text) {
  const matches = text.match(CADASTRAL_RE) || [];
  return [...new Set(matches)];
}

/**
 * Разобрать скачанный PDF в список кадастровых номеров.
 *
 * Бросает исключение, если число вне приёмочных границ: парсер, молча
 * потерявший половину перечня, хуже упавшего.
 */
export async function parseFile(pdfPath) {
  const buffer = await readFile(pdfPath);
  const cadastrals = parseCadastrals(extractText(buffer));

  if (cadastrals.length < EXPECTED_MIN || cadastrals.length > EXPECTED_MAX) {
    throw new Error(
      `Разобрано ${cadastrals.length} кадастровых номеров, ожидалось ` +
        `${EXPECTED_MIN}-${EXPECTED_MAX}. Парсер теряет данные или ловит мусор — ` +
        `чините до запуска сборки.`
    );
  }

  return cadastrals;
}
