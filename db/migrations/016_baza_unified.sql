-- ЕДИНАЯ «База» + «На проверку» + листы точек (задача Димы, п.4).
--
-- ЗАЧЕМ ОДНА БАЗА. У Димы было семь листов по типам. Он просил одну таблицу
-- со столбцом «Тип объекта» — так удобнее владельцу: один список, фильтр по
-- типу делает грид NocoDB, данные не дублируются. Семь прежних листов живут
-- как гриды-фильтры поверх этой же вьюхи.
--
-- ДВА ИСТОЧНИКА. Здания (БЦ/офисные/офисы компаний/ТЦ) — в kosmos.objects.
-- ВУЗ/НИИ — в kosmos.places (данные OSM). «База» их UNION-ит в один вид.
--
-- ЧТО ТАКОЕ ЧИСТАЯ БАЗА. Только то, чему доверяем: подтверждённые БЦ (OSM или
-- Арендатор), офисная геометрия, офисы компаний, ТЦ, ВУЗ/НИИ, и внешние БЦ,
-- одобренные Димой. БЕЗ вычтенных (наши/закрытые точки) и БЕЗ отклонённых (Хуй).
--
-- ОК/ХУЙ. NocoDB — витрина одностороннего показа (Postgres→NocoDB), правки в
-- ней назад не текут. Поэтому решение Дима выносит ЧЕРЕЗ БОТА, а бот пишет в
-- kosmos.verdicts. Здесь только читаем последний вердикт:
--   'интересно' = ОК (внешний объект попадает в Базу),
--   'отказ'     = Хуй (объект исчезает и из Базы, и из «На проверку»).
-- «На проверку» показывает то, по чему вердикта ещё нет.

-- Последний вердикт по объекту (человек мог менять мнение — берём свежий).
CREATE OR REPLACE VIEW vitrina._last_verdict AS
SELECT DISTINCT ON (object_id) object_id, verdict
FROM kosmos.verdicts
ORDER BY object_id, created_at DESC;

-- Человекочитаемый тип объекта из object_type.
CREATE OR REPLACE FUNCTION vitrina.tip_obekta(ot text, arendator boolean) RETURNS text AS $$
  SELECT CASE
    WHEN ot = 'бц' OR arendator THEN 'БЦ'
    WHEN ot = 'офис_компании'   THEN 'Офис компании'
    ELSE 'Офисное здание'
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- «База» — чистый список лидов: БЦ, офисные, офисы компаний, ВУЗ, НИИ.
-- ТЦ и конкуренты — отдельные листы (6/7), в единую Базу не входят.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS vitrina."База";
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
    o.cadastral_no                                              AS "Ключ"
FROM kosmos.objects o
LEFT JOIN vitrina._last_verdict v ON v.object_id = o.id
WHERE o.status NOT LIKE 'вычтен%'
  AND (v.verdict IS NULL OR v.verdict <> 'отказ')          -- не Хуй
  AND (
        -- реестровые: подтверждённые БЦ, офисы, ТЦ, либо офисная геометрия ≥10к
        (o.origin IS NULL AND (
            o.object_type IN ('бц','офисное_здание','офис_компании')
            OR o.arendator_matched
            OR (o.object_type = 'неизвестен' AND o.annex = 1 AND o.area_sqm >= 10000
                AND o.floors > 0 AND o.area_sqm / o.floors <= 3000
                AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)'))
        ))
        -- внешние (Макс/Арендатор/новостройки): только одобренные Димой
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
    'place:' || p.id
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind IN ('вуз','колледж','нии')
ORDER BY 1, 4 DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- «На проверку» — очередь на ОК/Хуй Димы (решает через бота).
-- Внешние БЦ без вердикта + реестровые неоднозначные (склад/молл/этажность).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS vitrina."На проверку";
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
    'ОК / Хуй — в боте'                                         AS "Решение",
    o.cadastral_no                                              AS "Ключ"
FROM kosmos.objects o
LEFT JOIN vitrina._last_verdict v ON v.object_id = o.id
WHERE o.status NOT LIKE 'вычтен%'
  AND v.verdict IS NULL                                    -- ещё не решено
  AND (
        o.origin IS NOT NULL                               -- все внешние — на проверку
        OR (o.origin IS NULL AND o.object_type = 'неизвестен' AND o.annex = 1
            AND o.area_sqm >= 10000
            AND (o.floors IS NULL OR o.floors = 0 OR o.area_sqm / o.floors > 3000)
            AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)'))
  )
ORDER BY (o.origin IS NULL), o.area_sqm DESC NULLS LAST;

-- ---------------------------------------------------------------------------
-- Точки МИЛТИ — справочные листы (Дима обновляет раз в 3 месяца).
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS vitrina."Открытые точки";
CREATE VIEW vitrina."Открытые точки" AS
SELECT name AS "Название", address_raw AS "Адрес",
       CASE WHEN lat IS NOT NULL THEN lat || ', ' || lon ELSE NULL END AS "Координаты",
       loaded_at::date AS "Загружено"
FROM kosmos.our_points ORDER BY name;

DROP VIEW IF EXISTS vitrina."Закрытые точки";
CREATE VIEW vitrina."Закрытые точки" AS
SELECT name AS "Название", address_raw AS "Адрес",
       CASE WHEN lat IS NOT NULL THEN lat || ', ' || lon ELSE NULL END AS "Координаты",
       loaded_at::date AS "Загружено"
FROM kosmos.closed_points ORDER BY name;
