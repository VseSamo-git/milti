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

export class Registry {
  /**
   * @param {{dbUrl: string}} cfg
   */
  constructor(cfg) {
    this.sql = postgres(cfg.dbUrl, { onnotice: () => {} });
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
    const rows = await this.sql`
      SELECT cadastral_no FROM kosmos.objects
      WHERE area_source IS NULL AND annex = 1
      ORDER BY id
    `;
    return rows.map((r) => r.cadastral_no);
  }

  /**
   * Проставить UNOM из адресного реестра.
   *
   * Без этого шага вычитание работает вхолостую: колонка пуста, совпадений
   * ноль, и Дима получает базу со своими же действующими точками внутри.
   * Кадастровые номера, которых нет в реестре, остаются NULL — не выдумываем.
   *
   * @param {Map<string, number>|Record<string, number>} unomMap
   */
  async applyUnomMap(unomMap) {
    const pairs = unomMap instanceof Map ? [...unomMap] : Object.entries(unomMap);
    if (pairs.length === 0) return 0;

    const CHUNK = 2000;
    let applied = 0;
    for (let i = 0; i < pairs.length; i += CHUNK) {
      const chunk = pairs.slice(i, i + CHUNK).map(([cadastral_no, unom]) => ({
        cadastral_no,
        unom,
      }));
      const result = await this.sql`
        UPDATE kosmos.objects o
        SET unom = v.unom::bigint
        FROM (VALUES ${this.sql(chunk.map((c) => [c.cadastral_no, String(c.unom)]))})
             AS v(cadastral_no, unom)
        WHERE o.cadastral_no = v.cadastral_no AND o.unom IS NULL
      `;
      applied += result.count;
    }
    return applied;
  }

  async countObjects() {
    const [row] = await this.sql`SELECT count(*)::int AS n FROM kosmos.objects`;
    return row.n;
  }

  async markBaselineComplete() {
    await this.sql`UPDATE kosmos.objects SET baseline_run = false`;
  }
}
