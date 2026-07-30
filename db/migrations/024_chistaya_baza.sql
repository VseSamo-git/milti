-- 024 — ЧИСТАЯ БАЗА. Три дефекта логики + решение ОК/Хуй во всех листах.
--
-- Пересоздаёт вью «База» и «На проверку» ПОВЕРХ 023: фильтр непрофильных
-- зданий (пожарные части, ЗАГС, диспансеры) из 023 здесь сохранён дословно —
-- он не должен потеряться при пересборке вью.
--
-- Найдено сверкой живой базы 30.07.2026. Каждый дефект — это строки, которые
-- Дима увидит в маршруте и съездит зря.
--
-- ДЕФЕКТ 1 — дубли комплексов в «Базе». Фильтр `status NOT LIKE 'вычтен%'`
--   пропускал `status='дубль_в_базе'`: 74 БЦ, помеченных как дубль другой
--   строки Базы, всё равно показывались. Отрицательный фильтр перечислял то,
--   что прячем, — и молча ломался при добавлении нового статуса. Везде заменён
--   на положительный `status = 'активен'`: новый статус по умолчанию скрыт,
--   а не показан.
--
-- ДЕФЕКТ 2 — ВУЗ/НИИ/колледжи вне всякого контроля. Часть B «Базы» (1118 строк
--   из kosmos.places) не имела ни фильтра статуса, ни вердикта. Следствия:
--   вычитание точек МИЛТИ их никогда не касалось (20 адресов, где МИЛТИ уже
--   работает или закрылся, висели в Базе), и отклонить их было нечем.
--   Здесь добавлены статусы вычитания для places и фильтры во вью; само
--   вычитание делает scripts/link_milti_points.js (теперь ходит и по places).
--
-- ДЕФЕКТ 3 — вердикт был привязан к kosmos.objects.id, поэтому ОК/Хуй
--   физически не мог существовать для ВУЗ/НИИ/конкурентов: у них нет строки
--   в objects. Вердикт переведён на текстовый `entity_key` — ровно тот «Ключ»,
--   который Дима видит в листе: кадастровый номер для зданий, `place:<id>`
--   для мест. Один механизм на все листы.
--
-- ПЛЮС: колонка «Решение (ОК / Хуй)» добавлена во ВСЕ рабочие листы, а не
--   только в «На проверку». Семантика:
--     Хуй → объект исчезает отовсюду (вердикт 'отказ');
--     ОК  → в «На проверку»/ТЦ/средних/конкурентах объект уезжает в «Базу»
--           (вердикт 'интересно'); в самой «Базе» ОК = «проверено, оставить».
--   Перенос по ОК проверяется на дубль по названию+адресу — vitrina.dubli_bazy.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Вердикт по универсальному ключу
-- ---------------------------------------------------------------------------
ALTER TABLE kosmos.verdicts ADD COLUMN IF NOT EXISTS entity_key TEXT;

-- Бэкфилл старых вердиктов (их сейчас нет, но миграция обязана быть повторяемой).
UPDATE kosmos.verdicts v
   SET entity_key = o.cadastral_no
  FROM kosmos.objects o
 WHERE o.id = v.object_id AND v.entity_key IS NULL;

DELETE FROM kosmos.verdicts WHERE entity_key IS NULL;  -- висяки без объекта
ALTER TABLE kosmos.verdicts ALTER COLUMN object_id DROP NOT NULL;
ALTER TABLE kosmos.verdicts ALTER COLUMN entity_key SET NOT NULL;
CREATE INDEX IF NOT EXISTS verdicts_entity_key_idx
    ON kosmos.verdicts (entity_key, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Места (ВУЗ/НИИ/колледж/конкурент) получают статусы вычитания
-- ---------------------------------------------------------------------------
ALTER TABLE kosmos.places DROP CONSTRAINT IF EXISTS valid_place_status;
ALTER TABLE kosmos.places ADD CONSTRAINT valid_place_status CHECK (status IN (
    'активна', 'кандидат_на_закрытие',
    'вычтен_наша_точка', 'вычтен_закрытая_точка', 'дубль_в_базе'));
ALTER TABLE kosmos.places ADD COLUMN IF NOT EXISTS subtract_reason TEXT;

-- ---------------------------------------------------------------------------
-- 3. Последний вердикт — теперь по ключу, а не по object_id
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS vitrina."База";
DROP VIEW IF EXISTS vitrina."На проверку";
DROP VIEW IF EXISTS vitrina."ТЦ с супермаркетом";
DROP VIEW IF EXISTS vitrina."Конкуренты";
DROP VIEW IF EXISTS vitrina."БЦ средние 5-10к";
DROP VIEW IF EXISTS vitrina._last_verdict;

CREATE VIEW vitrina._last_verdict AS
SELECT DISTINCT ON (entity_key) entity_key, verdict
FROM kosmos.verdicts
ORDER BY entity_key, created_at DESC;

-- ---------------------------------------------------------------------------
-- 4. «База»
-- ---------------------------------------------------------------------------
CREATE VIEW vitrina."База" AS
-- A. Здания из реестра и одобренные внешние
SELECT
    vitrina.tip_obekta(o.object_type, o.arendator_matched)      AS "Тип объекта",
    coalesce(o.title, '(без названия)')                         AS "Название",
    vitrina.addr_short(o.address)                               AS "Адрес",
    round(o.area_sqm)::int                                      AS "Площадь, м²",
    o.floors                                                    AS "Этажей",
    o.lat || ', ' || o.lon                                      AS "Координаты",
    CASE
        WHEN o.object_type = 'бц' AND o.arendator_matched THEN 'OSM + Арендатор'
        WHEN o.arendator_matched                          THEN 'Арендатор'
        WHEN o.object_type = 'бц'                         THEN 'карты OSM'
        WHEN o.origin IS NOT NULL                         THEN 'внешний, одобрен'
        WHEN o.floors > 0 AND o.area_sqm / o.floors <= 3000 THEN 'офисная геометрия'
        ELSE '—'
    END                                                         AS "Подтверждён",
    CASE WHEN o.origin IS NULL THEN 'реестр 700-ПП' ELSE o.origin END AS "Источник",
    NULL::text                                                  AS "Решение (ОК / Хуй)",
    o.cadastral_no                                              AS "Ключ"
FROM kosmos.objects o
LEFT JOIN vitrina._last_verdict v ON v.entity_key = o.cadastral_no
WHERE o.status = 'активен'                                 -- дефект 1
  AND (v.verdict IS NULL OR v.verdict <> 'отказ')          -- не Хуй
  AND (
        (o.origin IS NULL AND (
            ((o.object_type = 'бц' OR o.arendator_matched)
                AND (o.arendator_matched OR o.area_sqm >= 10000 OR o.area_sqm IS NULL))
            OR o.object_type IN ('офисное_здание','офис_компании')
            OR (o.object_type = 'неизвестен' AND o.annex = 1 AND o.area_sqm >= 10000
                AND o.floors > 0 AND o.area_sqm / o.floors <= 3000
                AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)'))
        ))
        OR (o.origin IS NOT NULL AND v.verdict = 'интересно')
  )
UNION ALL
-- B. ВУЗ / колледж / НИИ из OSM
SELECT
    CASE p.kind WHEN 'вуз' THEN 'ВУЗ' WHEN 'колледж' THEN 'Колледж' ELSE 'НИИ' END,
    coalesce(p.name, '(без названия)'),
    coalesce(vitrina.addr_short(p.address), vitrina.addr_short(o.address)),
    round(o.area_sqm)::int,
    o.floors,
    p.lat || ', ' || p.lon,
    'OSM',
    'OSM',
    NULL::text,
    'place:' || p.id
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
LEFT JOIN vitrina._last_verdict v ON v.entity_key = 'place:' || p.id
WHERE p.kind IN ('вуз','колледж','нии')
  AND p.status = 'активна'                                 -- дефект 2
  AND (v.verdict IS NULL OR v.verdict <> 'отказ')
ORDER BY 1, 4 DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- 5. «На проверку» — очередь ОК/Хуй
-- ---------------------------------------------------------------------------
CREATE VIEW vitrina."На проверку" AS
SELECT
    CASE WHEN o.origin IS NOT NULL THEN 'внешний БЦ' ELSE 'реестр: профиль неясен' END AS "Что это",
    coalesce(o.title, '(без названия)')                         AS "Название",
    vitrina.addr_short(o.address)                               AS "Адрес",
    round(o.area_sqm)::int                                      AS "Площадь, м²",
    o.floors                                                    AS "Этажей",
    o.lat || ', ' || o.lon                                      AS "Координаты",
    CASE
        WHEN o.origin IS NOT NULL THEN coalesce(o.origin,'') || ' (каталог, не проверен)'
        WHEN o.floors IS NULL OR o.floors = 0 THEN 'этажность неизвестна'
        WHEN o.area_sqm / o.floors > 3000     THEN 'широкое: склад/молл?'
        ELSE 'проверить'
    END                                                         AS "Почему на проверке",
    o.baza_dubl_hint                                            AS "Возможно уже в Базе",
    NULL::text                                                  AS "Решение (ОК / Хуй)",
    o.cadastral_no                                              AS "Ключ"
FROM kosmos.objects o
LEFT JOIN vitrina._last_verdict v ON v.entity_key = o.cadastral_no
WHERE o.status = 'активен'
  AND v.verdict IS NULL
  AND (
        o.origin IS NOT NULL
        OR (o.origin IS NULL AND o.object_type = 'неизвестен' AND o.annex = 1
            AND o.area_sqm >= 10000
            AND (o.floors IS NULL OR o.floors = 0 OR o.area_sqm / o.floors > 3000)
            AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)'))
  )
ORDER BY (o.origin IS NULL), o.area_sqm DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- 6. «ТЦ с супермаркетом» — не имел ни статуса, ни вердикта
-- ---------------------------------------------------------------------------
CREATE VIEW vitrina."ТЦ с супермаркетом" AS
SELECT
    coalesce(o.title, vitrina.addr_short(o.address))            AS "Название ТЦ",
    vitrina.addr_short(o.address)                               AS "Адрес",
    o.supermarkets                                              AS "Продуктовый супермаркет",
    round(o.area_sqm)::int                                      AS "Общая площадь, м²",
    o.floors                                                    AS "Этажей",
    NULL::text                                                  AS "Решение (ОК / Хуй)",
    o.cadastral_no                                              AS "Ключ"
FROM kosmos.objects o
LEFT JOIN vitrina._last_verdict v ON v.entity_key = o.cadastral_no
WHERE o.object_type = 'тц'
  AND o.status = 'активен'
  AND (v.verdict IS NULL OR v.verdict <> 'отказ')
ORDER BY o.area_sqm DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- 7. «Конкуренты» — у мест не было ключа, значит и решения быть не могло
-- ---------------------------------------------------------------------------
CREATE VIEW vitrina."Конкуренты" AS
SELECT
    p.chain                                                     AS "Сеть",
    vitrina.addr_short(coalesce(p.address,
        nullif(btrim(coalesce(p.street,'') || ' ' || coalesce(p.house,'')), ''))) AS "Адрес",
    CASE p.status WHEN 'активна' THEN 'работает'
                  WHEN 'кандидат_на_закрытие' THEN 'возможно закрылась'
                  ELSE p.status END                             AS "Статус",
    CASE WHEN p.source = 'osm_secondary' THEN 'OpenStreetMap — выборка, неполно'
         ELSE 'store-locator сети — полно' END                  AS "Источник",
    to_char(p.first_seen_at, 'DD.MM.YYYY')                      AS "Впервые увидели",
    to_char(p.last_seen_at,  'DD.MM.YYYY')                      AS "Последний раз видели",
    NULL::text                                                  AS "Решение (ОК / Хуй)",
    'place:' || p.id                                            AS "Ключ"
FROM kosmos.places p
LEFT JOIN vitrina._last_verdict v ON v.entity_key = 'place:' || p.id
WHERE p.kind = 'конкурент'
  AND p.status IN ('активна','кандидат_на_закрытие')
  AND (v.verdict IS NULL OR v.verdict <> 'отказ')
ORDER BY p.chain, p.address;

-- ---------------------------------------------------------------------------
-- 8. «БЦ средние 5-10к»
-- ---------------------------------------------------------------------------
CREATE VIEW vitrina."БЦ средние 5-10к" AS
SELECT
    o.title                                                     AS "Название БЦ",
    vitrina.addr_short(o.address)                               AS "Адрес",
    round(o.area_sqm)::int                                      AS "Общая площадь, м²",
    o.floors                                                    AS "Этажей",
    o.built_year                                                AS "Год постройки",
    CASE
        WHEN o.object_type = 'бц' AND o.arendator_matched THEN 'OSM + Арендатор'
        WHEN o.arendator_matched                          THEN 'Арендатор'
        ELSE 'карты OSM'
    END                                                         AS "Подтверждён",
    NULL::text                                                  AS "Решение (ОК / Хуй)",
    o.cadastral_no                                              AS "Ключ"
FROM kosmos.objects o
LEFT JOIN vitrina._last_verdict v ON v.entity_key = o.cadastral_no
WHERE o.status = 'активен'
  AND o.annex = 1
  AND o.area_sqm >= 5000 AND o.area_sqm < 10000
  AND (o.object_type = 'бц' OR o.arendator_matched)
  AND (v.verdict IS NULL OR v.verdict <> 'отказ')
ORDER BY o.area_sqm DESC;

-- ---------------------------------------------------------------------------
-- 9. Дубли внутри «Базы» — служебный вид, вход для дедупа при переносе по ОК
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW vitrina.dubli_bazy AS
SELECT "Название", "Адрес", count(*) AS "Строк", array_agg("Ключ") AS "Ключи"
FROM vitrina."База"
WHERE "Название" <> '(без названия)'
GROUP BY 1, 2
HAVING count(*) > 1;

COMMIT;
