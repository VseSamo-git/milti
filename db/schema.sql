-- КОСМОС — реестр базы лидов отдела развития МИЛТИ
--
-- Источник правды. Google Sheets и NocoDB — поверхности над этим,
-- а не хранилища.
--
-- Главный принцип, закреплённый здесь механически: ни одно значение
-- не записывается без указания источника. NULL — легитимное значение.
-- Пустая ячейка честнее выдуманной. Смотрите CHECK-констрейнты ниже:
-- выдуманное число физически не запишется, даже если разработчик захочет.

CREATE SCHEMA IF NOT EXISTS kosmos;

-- ---------------------------------------------------------------------------
-- observations — журнал сырых наблюдений. Только дописывание.
-- Чёрный ящик: ответ на вопрос «откуда взялась эта цифра».
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kosmos.observations (
    id           BIGSERIAL PRIMARY KEY,
    source       TEXT        NOT NULL,   -- 'pp700' | 'nspd' | 'addr_registry' | '2gis'
    observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    cadastral_no TEXT,
    payload      JSONB       NOT NULL,   -- сырой ответ источника
    source_url   TEXT,
    object_id    BIGINT
);
CREATE INDEX IF NOT EXISTS observations_cadastral_idx ON kosmos.observations (cadastral_no);
CREATE INDEX IF NOT EXISTS observations_source_idx    ON kosmos.observations (source, observed_at);

-- ---------------------------------------------------------------------------
-- objects — реестр, склеенная правда. Один объект = одна строка.
--
-- ВНИМАНИЕ. Сюда пишет ТОЛЬКО машина. Человек пишет в verdicts.
-- В NocoDB вид на эту таблицу обязан быть read-only (Allow Data Edit = off),
-- иначе следующий прогон обогащения молча затрёт правку Димы.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kosmos.objects (
    id                  BIGSERIAL PRIMARY KEY,
    cadastral_no        TEXT UNIQUE NOT NULL,
    object_type         TEXT NOT NULL DEFAULT 'неизвестен',
    address             TEXT,
    unom                BIGINT,
    lat                 DOUBLE PRECISION,
    lon                 DOUBLE PRECISION,

    -- Приложение перечня 700-ПП: 1 = здание, 2 = помещение.
    -- Обогащаем через НСПД только приложение 1: у помещений area — это
    -- площадь комнаты, а не здания. Проверено разведкой: все помещения
    -- выборки дали 13,6-621,2 м². Экономит 19 480 запросов (~5,4 часа).
    annex               INTEGER,

    -- Площадь и её провенанс.
    area_sqm            NUMERIC(12, 2),
    area_confidence     TEXT,   -- 'точно' | 'оценка' | 'неизвестно'
    area_source         TEXT,   -- обязателен, если area_sqm IS NOT NULL

    floors              INTEGER,
    floors_source       TEXT,
    built_year          INTEGER,
    built_year_source   TEXT,

    -- Дата запуска. НЕ путать с built_year: Дима просит именно дату запуска,
    -- а год постройки — это другое.
    commissioning_date  DATE,
    commissioning_conf  TEXT,   -- 'точно' (реестр РВ) | 'оценка' (01.01.built_year)

    org_count           INTEGER,
    org_count_source    TEXT,

    -- Название БЦ. В перечне 700-ПП его нет, в ЕГРН — свободный текст
    -- («Корпус 4»). Приходит из 2ГИС по платному договору.
    title               TEXT,
    title_source        TEXT,

    -- Расстояние до ближайшей нашей точки. Это КОЛОНКА, а не причина
    -- вычитания. Вычитаем только по точному совпадению UNOM.
    nearest_point_m     INTEGER,
    nearest_point_name  TEXT,

    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    status              TEXT NOT NULL DEFAULT 'активен',
    subtract_reason     TEXT,

    -- Первая загрузка не подсвечивается как «новое»: иначе Дима в первое
    -- воскресенье получит 3 400 «новых» БЦ.
    baseline_run        BOOLEAN NOT NULL DEFAULT false,

    -- Провенанс не на честном слове, а механически.
    CONSTRAINT area_needs_source       CHECK (area_sqm    IS NULL OR area_source       IS NOT NULL),
    CONSTRAINT area_needs_confidence   CHECK (area_sqm    IS NULL OR area_confidence   IS NOT NULL),
    CONSTRAINT floors_needs_source     CHECK (floors      IS NULL OR floors_source     IS NOT NULL),
    CONSTRAINT built_year_needs_source CHECK (built_year  IS NULL OR built_year_source IS NOT NULL),
    CONSTRAINT org_count_needs_source  CHECK (org_count   IS NULL OR org_count_source  IS NOT NULL),
    CONSTRAINT title_needs_source      CHECK (title       IS NULL OR title_source      IS NOT NULL),
    CONSTRAINT commissioning_needs_conf
        CHECK (commissioning_date IS NULL OR commissioning_conf IS NOT NULL),

    CONSTRAINT valid_object_type CHECK (object_type IN (
        'бц', 'офисное_здание', 'офис_компании', 'нии', 'вуз',
        'конкурент', 'в_стройке', 'неизвестен'
    )),
    CONSTRAINT valid_status CHECK (status IN (
        'активен', 'не_найден_в_последнем_обходе',
        'вычтен_наша_точка', 'вычтен_закрытая_точка'
    )),
    CONSTRAINT valid_area_confidence
        CHECK (area_confidence IS NULL OR area_confidence IN ('точно', 'оценка', 'неизвестно')),
    CONSTRAINT valid_commissioning_conf
        CHECK (commissioning_conf IS NULL OR commissioning_conf IN ('точно', 'оценка'))
);
CREATE INDEX IF NOT EXISTS objects_unom_idx   ON kosmos.objects (unom);
CREATE INDEX IF NOT EXISTS objects_area_idx   ON kosmos.objects (area_sqm);
CREATE INDEX IF NOT EXISTS objects_status_idx ON kosmos.objects (status);
CREATE INDEX IF NOT EXISTS objects_annex_idx  ON kosmos.objects (annex);

-- ---------------------------------------------------------------------------
-- verdicts — то, что сказал человек. Отдельно от машинных данных.
--
-- Это единственная таблица, куда Дима пишет. В NocoDB она редактируемая.
-- Пометка «был там, площадь врёт» не должна затираться ничем и никогда.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kosmos.verdicts (
    id          BIGSERIAL PRIMARY KEY,
    object_id   BIGINT      NOT NULL REFERENCES kosmos.objects(id),
    author      TEXT        NOT NULL,
    verdict     TEXT        NOT NULL,   -- 'интересно' | 'не_наш_формат' | 'проверить' | 'отказ'
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verdicts_object_idx ON kosmos.verdicts (object_id);

-- ---------------------------------------------------------------------------
-- Точки МИЛТИ. Даёт Дима, обновляет раз в месяц.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kosmos.our_points (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT,
    address_raw TEXT NOT NULL,
    unom        BIGINT,
    lat         DOUBLE PRECISION,
    lon         DOUBLE PRECISION,
    resolved    BOOLEAN NOT NULL DEFAULT false,
    loaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kosmos.closed_points (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT,
    address_raw TEXT NOT NULL,
    unom        BIGINT,
    lat         DOUBLE PRECISION,
    lon         DOUBLE PRECISION,
    resolved    BOOLEAN NOT NULL DEFAULT false,
    loaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kosmos.runs (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL,   -- 'baseline' | 'weekly'
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status      TEXT NOT NULL DEFAULT 'running',
    note        TEXT
);

-- ---------------------------------------------------------------------------
-- Вид для Димы. Это то, что он видит в NocoDB.
--
-- Только объекты, прошедшие фильтр, с уже вычтенными нашими точками
-- и приклеенным последним вердиктом.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW kosmos.v_leads AS
SELECT
    o.id,
    o.title              AS "Название",
    o.address            AS "Адрес",
    o.area_sqm           AS "Площадь, м2",
    o.area_confidence    AS "Достоверность площади",
    o.floors             AS "Этажей",
    o.commissioning_date AS "Дата запуска",
    o.org_count          AS "Организаций",
    o.nearest_point_m    AS "Ближайшая наша точка, м",
    o.first_seen_at      AS "Найден",
    v.verdict            AS "Вердикт",
    v.note               AS "Комментарий",
    o.cadastral_no       AS "Кадастровый номер"
FROM kosmos.objects o
LEFT JOIN LATERAL (
    SELECT verdict, note
    FROM kosmos.verdicts
    WHERE object_id = o.id
    ORDER BY created_at DESC
    LIMIT 1
) v ON true
WHERE o.status = 'активен'
  AND o.area_sqm >= 10000
ORDER BY o.area_sqm DESC;

COMMENT ON VIEW kosmos.v_leads IS
    'Рабочий список Димы. Read-only: правки идут в kosmos.verdicts.';
