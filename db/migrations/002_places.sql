-- Точки на карте из OpenStreetMap: конкуренты, ВУЗы, НИИ, супермаркеты.
--
-- ПОЧЕМУ ОТДЕЛЬНАЯ ТАБЛИЦА, а не objects.
-- objects — реестр ЗДАНИЙ, ключ — кадастровый номер, правило «один объект =
-- одно здание». А Шоколадница — это точка ВНУТРИ здания, у неё нет своего
-- кадастрового номера. ВУЗ — учреждение, которое может занимать несколько
-- корпусов. Смешивать сущности значит сломать ключ и правило.
--
-- Связь с реестром: place.object_id заполняется, когда по координате точки
-- находим здание. Тогда ВУЗ получает площадь из Росреестра, а супермаркет
-- отвечает на вопрос «это ТЦ или Пятёрочка на первом этаже жилого дома».
--
-- Для конкурентов здание вообще не нужно: Диме нужен их адрес, а не метраж.
--
-- ЛИЦЕНЗИЯ ДАННЫХ: OpenStreetMap, ODbL. Требуется атрибуция.

CREATE TABLE IF NOT EXISTS kosmos.places (
    id            BIGSERIAL PRIMARY KEY,
    osm_id        TEXT UNIQUE NOT NULL,   -- 'node/123', 'way/456' — стабильный ключ OSM
    kind          TEXT NOT NULL,
    chain         TEXT,                   -- сеть: для конкурентов и супермаркетов
    name          TEXT,
    lat           DOUBLE PRECISION NOT NULL,
    lon           DOUBLE PRECISION NOT NULL,
    street        TEXT,
    house         TEXT,

    -- Здание, в котором сидит точка. Заполняется по координате, позже.
    object_id     BIGINT REFERENCES kosmos.objects(id),

    -- Дима просит «количество студентов по этому адресу». Источника нет
    -- ни у кого: статистика даёт число на весь ВУЗ, а не по корпусам.
    -- NULL легитимен — пустая ячейка честнее выдуманной.
    students      INTEGER,
    students_source TEXT,

    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    status        TEXT NOT NULL DEFAULT 'активна',
    source        TEXT NOT NULL,
    baseline_run  BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT valid_place_kind CHECK (kind IN (
        'конкурент', 'вуз', 'колледж', 'нии', 'супермаркет'
    )),
    -- «Кандидат на закрытие», а не «закрыта»: OSM живёт правками людей,
    -- пропажа точки не доказывает, что заведение закрылось.
    CONSTRAINT valid_place_status CHECK (status IN (
        'активна', 'кандидат_на_закрытие'
    )),
    CONSTRAINT students_needs_source
        CHECK (students IS NULL OR students_source IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS places_kind_idx   ON kosmos.places (kind);
CREATE INDEX IF NOT EXISTS places_chain_idx  ON kosmos.places (chain);
CREATE INDEX IF NOT EXISTS places_object_idx ON kosmos.places (object_id);
CREATE INDEX IF NOT EXISTS places_status_idx ON kosmos.places (status);

COMMENT ON TABLE kosmos.places IS
    'Точки OSM: конкуренты, ВУЗы, НИИ, супермаркеты. Данные © OpenStreetMap contributors, ODbL.';

-- Лист «Конкуренты» для Димы.
CREATE OR REPLACE VIEW kosmos.v_competitors AS
SELECT
    p.chain                                   AS "Сеть",
    p.name                                    AS "Название",
    coalesce(o.address, p.street || ' ' || coalesce(p.house, '')) AS "Адрес",
    p.status                                  AS "Статус",
    p.first_seen_at::date                     AS "Найдена",
    p.last_seen_at::date                      AS "Последний раз видели",
    p.lat, p.lon
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind = 'конкурент'
ORDER BY p.chain, p.first_seen_at DESC;

-- Лист «ВУЗы» для Димы. Площадь приезжает из Росреестра через object_id.
CREATE OR REPLACE VIEW kosmos.v_universities AS
SELECT
    p.name                AS "Название ВУЗа",
    coalesce(o.address, p.street || ' ' || coalesce(p.house, '')) AS "Адрес",
    o.area_sqm            AS "Общая площадь, м2",
    p.students            AS "Студентов по адресу",
    p.kind                AS "Тип",
    p.lat, p.lon
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind IN ('вуз', 'колледж')
ORDER BY o.area_sqm DESC NULLS LAST;

-- Лист «НИИ» для Димы.
CREATE OR REPLACE VIEW kosmos.v_research AS
SELECT
    p.name                AS "Название НИИ",
    coalesce(o.address, p.street || ' ' || coalesce(p.house, '')) AS "Адрес",
    o.area_sqm            AS "Общая площадь, м2",
    p.lat, p.lon
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind = 'нии'
ORDER BY o.area_sqm DESC NULLS LAST;
