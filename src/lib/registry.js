/**
 * Реестр КОСМОС — единственное место, где пишутся объекты.
 *
 * ПРАВИЛО: машина пишет в objects, человек — в verdicts. Никогда наоборот.
 * Пометка Димы «был там, площадь врёт» не должна затираться ничем.
 *
 * ПРОВЕНАНС: ни одно значение не пишется без источника. Здесь это не
 * дисциплина, а механика — CHECK-констрейнты в схеме не дадут записать
 * площадь без area_source. Если руки тянутся передать источник «на всякий
 * случай» при пустом значении — не надо: NULL легитимен, и констрейнт
 * требует источник только когда значение есть.
 */
import postgres from 'postgres';

export const SOURCE_PP700 = 'pp700';
export const SOURCE_NSPD = 'nspd';
export const SOURCE_ADDR_REGISTRY = 'addr_registry';

/**
 * Статусы мест, которые НЕ имеет права трогать повторный импорт.
 *
 * Каждый из них — чьё-то решение: вычитание точки МИЛТИ, удаление по слову
 * Димы, признание дублём. Импорт видит место в источнике снова и хочет
 * сказать «оно активно» — но источник не знает про наши решения.
 * Единственный статус, который повторная встреча законно снимает, —
 * 'кандидат_на_закрытие': мы предполагали, что место исчезло, а оно на месте.
 */
export const PLACE_STATUSES_KEPT_ON_REIMPORT = Object.freeze([
  'вычтен_наша_точка',
  'вычтен_закрытая_точка',
  'вычтен_решением_димы',
  'дубль_в_базе',
]);

export class Registry {
  /**
   * @param {{dbUrl: string}} cfg
   */
  constructor(cfg) {
    // ssl: 'require' обязателен для облачного Postgres (Supabase и т.п.).
    // Без него Supabase отвергает соединение, но отдаёт это как 28P01
    // «password authentication failed» — ошибка врёт про причину, проверено.
    // Для локального Postgres без TLS ставьте KOSMOS_DB_SSL=off.
    this.sql = postgres(cfg.dbUrl, {
      onnotice: () => {},
      ssl: cfg.dbSsl,
      max: cfg.dbMaxConnections,
    });
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }

  /**
   * Журнал сырых наблюдений. Только дописывание.
   */
  async recordObservation({ source, cadastralNo = null, payload, sourceUrl = null }) {
    const [row] = await this.sql`
      INSERT INTO kosmos.observations (source, cadastral_no, payload, source_url)
      VALUES (${source}, ${cadastralNo}, ${this.sql.json(payload)}, ${sourceUrl})
      RETURNING id
    `;
    return row.id;
  }

  /**
   * Загрузить состав из перечня 700-ПП.
   *
   * Перечень даёт ТОЛЬКО кадастровый номер, приложение и адрес.
   * Площади в нём нет — не пытайтесь её сюда записать.
   *
   * @param {Array<{cadastralNo: string, annex: number}>} entries
   * @returns {Promise<number>} сколько строк затронуто
   */
  async upsertFromPp700(entries) {
    if (entries.length === 0) return 0;

    const rows = entries.map((e) => ({
      cadastral_no: e.cadastralNo,
      annex: e.annex,
      baseline_run: true,
    }));

    // Пачками: 42 650 строк одним запросом положат сервер.
    const CHUNK = 1000;
    let affected = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const result = await this.sql`
        INSERT INTO kosmos.objects ${this.sql(chunk, 'cadastral_no', 'annex', 'baseline_run')}
        ON CONFLICT (cadastral_no) DO UPDATE
          SET annex = EXCLUDED.annex, last_seen_at = now()
      `;
      affected += result.count;
    }
    return affected;
  }

  /**
   * Записать данные ЕГРН по объекту.
   *
   * Источник указывается ТОЛЬКО когда значение есть. Иначе NULL и NULL —
   * пустая ячейка честнее выдуманной, и констрейнт это стережёт.
   *
   * Адрес берём из ЕГРН (readable_address): он чище, чем в перечне,
   * где лежит глифами и требует CMap.
   */
  async applyNspd(cadastralNo, record) {
    const hasArea = record.areaSqm !== null && record.areaSqm !== undefined;
    const hasFloors = record.floors !== null && record.floors !== undefined;
    const hasYear = record.builtYear !== null && record.builtYear !== undefined;

    await this.sql`
      UPDATE kosmos.objects SET
        area_sqm          = ${record.areaSqm ?? null},
        area_source       = ${hasArea ? SOURCE_NSPD : null},
        area_confidence   = ${hasArea ? 'точно' : null},
        floors            = ${record.floors ?? null},
        floors_source     = ${hasFloors ? SOURCE_NSPD : null},
        built_year        = ${record.builtYear ?? null},
        built_year_source = ${hasYear ? SOURCE_NSPD : null},
        address           = COALESCE(${record.readableAddress ?? null}, address),
        last_seen_at      = now()
      WHERE cadastral_no = ${cadastralNo}
    `;
  }

  /**
   * Кадастровые номера к обогащению. Основа возобновляемости: часы работы
   * нельзя терять из-за одного таймаута.
   *
   * ТОЛЬКО приложение 1 (здания). У помещений приложения 2 поле area —
   * это площадь комнаты, а не здания (проверено: 13,6-621,2 м² в выборке),
   * они заведомо не пройдут фильтр 10 000 м². 19 480 запросов к ним —
   * 5,4 часа впустую. Их ветка — отдельный план.
   */
  async pendingCadastrals() {
    // ПОРЯДОК ВАЖЕН, а не произволен. Обход занимает ~36 часов, поэтому
    // важно не «когда закончится», а «когда появится польза».
    //
    // Самый сильный до-обогащения сигнал размера — арендаторы (org_count):
    // здания с юрлицами внутри дают ≥10k в 30,6% случаев против 7,8% без них,
    // средняя площадь 14 368 против 3 843 м². Их спрашиваем ПЕРВЫМИ: таких
    // среди непройденных ~1236, за ~20 минут они дают Диме ~370 новых БЦ.
    //
    // Дальше — именованные (название из OSM: вдвое крупнее прочих, ≥10k в
    // 12,4% против 6,3%), затем по убыванию этажности, если она уже известна:
    // высокое здание почти всегда большое.
    const rows = await this.sql`
      SELECT cadastral_no FROM kosmos.objects
      WHERE area_source IS NULL AND annex = 1
      ORDER BY
        (org_count IS NULL OR org_count = 0),  -- сначала здания с арендаторами
        org_count DESC NULLS LAST,             -- больше юрлиц — раньше
        (title IS NULL),                       -- потом именованные
        floors DESC NULLS LAST,                -- потом высокие
        id
    `;
    return rows.map((r) => r.cadastral_no);
  }

  /**
   * Проставить UNOM и координаты из адресного реестра.
   *
   * Без UNOM вычитание работает вхолостую: колонка пуста, совпадений ноль,
   * и Дима получает базу со своими же действующими точками внутри.
   * Координаты нужны для связки «здание → площадка»: без них у ТЦ и ВУЗов
   * нет способа определить здание, а лид без гео не показать на карте.
   *
   * COALESCE, а не перезапись: система никогда не затирает уже известное
   * значение (спека, раздел 8). Заполняем только пустые ячейки — поэтому
   * координаты долетают и до зданий, где UNOM проставлен прошлым прогоном.
   * Кадастровых номеров, которых нет в реестре, не выдумываем — остаются NULL.
   *
   * Значение карты — запись { unom, lat, lon }. Старый формат (голое число
   * UNOM в кэше на диске) поддержан для совместимости: трактуем как запись
   * без координат.
   *
   * @param {Map<string, {unom:number,lat:number|null,lon:number|null}|number>
   *        |Record<string, {unom:number,lat:number|null,lon:number|null}|number>} unomMap
   */
  async applyUnomMap(unomMap) {
    const pairs = unomMap instanceof Map ? [...unomMap] : Object.entries(unomMap);
    if (pairs.length === 0) return 0;

    const norm = (value) =>
      typeof value === 'object' && value !== null
        ? { unom: value.unom, lat: value.lat ?? null, lon: value.lon ?? null }
        : { unom: value, lat: null, lon: null };

    const CHUNK = 2000;
    let applied = 0;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const chunk = pairs.slice(i, i + CHUNK).map(([cadastral_no, value]) => {
        const { unom, lat, lon } = norm(value);
        return [cadastral_no, String(unom), lat, lon];
      });
      const result = await this.sql`
        UPDATE kosmos.objects o
        SET unom = COALESCE(o.unom, v.unom::bigint),
            lat  = COALESCE(o.lat,  v.lat::double precision),
            lon  = COALESCE(o.lon,  v.lon::double precision)
        FROM (VALUES ${this.sql(chunk)})
             AS v(cadastral_no, unom, lat, lon)
        WHERE o.cadastral_no = v.cadastral_no
          AND (
            (o.unom IS NULL AND v.unom IS NOT NULL) OR
            (o.lat  IS NULL AND v.lat  IS NOT NULL) OR
            (o.lon  IS NULL AND v.lon  IS NOT NULL)
          )
      `;
      applied += result.count;
    }
    return applied;
  }

  async countObjects() {
    const [row] = await this.sql`SELECT count(*)::int AS n FROM kosmos.objects`;
    return row.n;
  }

  /**
   * Покрытие UNOM среди ЗДАНИЙ (приложение 1).
   *
   * Считать по всем объектам нельзя: помещения приложения 2 имеют номер
   * комнаты, а карта UNOM отображает номера зданий — у них покрытие ~1%
   * по построению, и общий процент (проверено: 49%) ложно завалил бы порог.
   * Реальное покрытие зданий — 92%.
   */
  async unomCoverageBuildings() {
    const [row] = await this.sql`
      SELECT
        count(*) FILTER (WHERE annex = 1)::int                        AS buildings,
        count(*) FILTER (WHERE annex = 1 AND unom IS NOT NULL)::int   AS with_unom
      FROM kosmos.objects
    `;
    return { buildings: row.buildings, withUnom: row.with_unom };
  }

  async markBaselineComplete() {
    await this.sql`UPDATE kosmos.objects SET baseline_run = false`;
  }
  /**
   * Записать точки (конкуренты со store-locator'ов, ВУЗы/НИИ/супермаркеты из OSM).
   *
   * Ключ — place_key: у OSM это 'node/123', у store-locator — 'chain:slug'.
   * Провенанс построчный: source и confidence можно задать в самой точке
   * (store-locator знает свой домен), либо через параметр source (OSM-источники).
   * Координаты необязательны: French Bakery отдаёт адрес без них.
   * Повторный обход обновляет last_seen_at и воскрешает статус.
   *
   * @param {{placeKey?,osmId?,kind,chain?,name?,lat?,lon?,street?,house?,address?,source?,confidence?}[]} places
   * @param {string} [source] — источник по умолчанию для точек без своего
   */
  async upsertPlaces(places, source) {
    if (!places.length) return 0;
    const CHUNK = 500;
    let n = 0;
    for (let i = 0; i < places.length; i += CHUNK) {
      const rows = places.slice(i, i + CHUNK).map((p) => {
        const src = p.source ?? source;
        const address = p.address ?? null;
        return {
          place_key: p.placeKey ?? p.osmId,
          kind: p.kind,
          chain: p.chain ?? null,
          name: p.name ?? null,
          lat: p.lat ?? null,
          lon: p.lon ?? null,
          street: p.street ?? null,
          house: p.house ?? null,
          address,
          // Констрейнт address_needs_source: адрес без источника недопустим.
          // Адрес пришёл из того же источника, что и точка (миграция 004
          // так же бэкофиллила старые строки). Нет адреса — нет и источника.
          address_source: address === null ? null : (p.addressSource ?? src),
          source: src,
          confidence: p.confidence ?? 'high',
        };
      });
      const res = await this.sql`
        INSERT INTO kosmos.places ${this.sql(
          rows,
          'place_key', 'kind', 'chain', 'name', 'lat', 'lon', 'street', 'house', 'address', 'address_source', 'source', 'confidence'
        )}
        ON CONFLICT (place_key) DO UPDATE SET
          name           = EXCLUDED.name,
          chain          = EXCLUDED.chain,
          lat            = EXCLUDED.lat,
          lon            = EXCLUDED.lon,
          street         = EXCLUDED.street,
          house          = EXCLUDED.house,
          address        = EXCLUDED.address,
          address_source = EXCLUDED.address_source,
          source         = EXCLUDED.source,
          confidence     = EXCLUDED.confidence,
          last_seen_at   = now(),
          -- СТАТУС-РЕШЕНИЕ ПЕРЕЖИВАЕТ ПОВТОРНЫЙ ИМПОРТ.
          -- Было status = 'активна' безусловно, и это молча воскрешало всё
          -- вычтенное: 284 колледжа, удалённых Димой, 20 мест, где МИЛТИ уже
          -- работает или закрылся, 34 дубля — 532 строки на 18.08.2026.
          -- Проверено контрольной строкой на живой базе: после повторного
          -- импорта статус становился 'активна'.
          -- Пересмотр статуса при повторной встрече законен ровно в одном
          -- случае: место числилось кандидатом на закрытие, а мы его снова
          -- увидели — значит, живо. Всё остальное это решение (Димы или
          -- сверки), и импорт не вправе его отменять.
          status = CASE WHEN places.status = 'кандидат_на_закрытие'
                        THEN 'активна' ELSE places.status END
      `;
      n += res.count ?? rows.length;
    }
    return n;
  }

  /**
   * Разовая чистка перед переходом на store-locator'ы: удалить конкурентов,
   * собранных из OSM. Это НЕ нарушение принципа «система не удаляет»: мы не
   * помечаем реальные точки закрытыми, а вычищаем данные из дискредитированного
   * источника (OSM давал 4–141% покрытия). Точность важнее сохранности мусора.
   * @returns {number} сколько строк удалено
   */
  async deleteCompetitorsFromSource(source = 'osm_competitors') {
    const res = await this.sql`
      DELETE FROM kosmos.places WHERE kind = 'конкурент' AND source = ${source}
    `;
    return res.count ?? 0;
  }

  /**
   * Пометить точки, которых не было в свежем обходе.
   *
   * Именно пометить, а не удалить: OSM живёт правками людей, и точка может
   * пропасть из-за чужой ошибки. Статус «кандидат_на_закрытие» — приглашение
   * проверить, а не утверждение, что заведение закрылось.
   */
  async markMissingPlaces(kind, seenKeys, { excludeSources = [] } = {}) {
    const res = await this.sql`
      UPDATE kosmos.places
      SET status = 'кандидат_на_закрытие'
      WHERE kind = ${kind}
        AND status = 'активна'
        AND NOT (place_key = ANY(${seenKeys}))
        AND NOT (source = ANY(${excludeSources}))
    `;
    return res.count ?? 0;
  }

  async countPlaces(kind) {
    const [row] = await this.sql`
      SELECT count(*)::int AS n FROM kosmos.places WHERE kind = ${kind}
    `;
    return row.n;
  }
}
