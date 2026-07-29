-- Порог площади для БЦ в «Базе» (решение Димы: работаем только с ≥10к).
--
-- ПРОБЛЕМА. Метка object_type='бц' ставится по названию из OSM БЕЗ учёта
-- размера. Из 1657 «БЦ» в Базе лишь 426 были ≥10к, а 456 — вообще <1000 м²
-- (кофейня «в бизнес-центре» — не лид). Это засоряло список.
--
-- РЕШЕНИЕ. В единой Базе БЦ проходит, только если:
--   • подтверждён Арендатором (каталог гарантирует ≥10к), ИЛИ
--   • площадь по факту ≥10 000 м², ИЛИ
--   • площадь ещё не обогащена (NULL) — держим до прохода НСПД, не теряем.
-- БЦ 5–10к — отдельный лист «8 БЦ средние 5-10к» (Дима решает сам).
-- БЦ <5к с известной площадью — не лид, из Базы уходят (объект в БД остаётся).

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
  AND (v.verdict IS NULL OR v.verdict <> 'отказ')
  AND (
        (o.origin IS NULL AND (
            -- БЦ: только ≥10к / подтверждён Арендатором / площадь пока пустая
            ((o.object_type = 'бц' OR o.arendator_matched)
                AND (o.arendator_matched OR o.area_sqm >= 10000 OR o.area_sqm IS NULL))
            -- офисные типы (классификация не по OSM-имени)
            OR o.object_type IN ('офисное_здание','офис_компании')
            -- офисная геометрия ≥10к среди неразмеченных
            OR (o.object_type = 'неизвестен' AND NOT coalesce(o.arendator_matched, false)
                AND o.annex = 1 AND o.area_sqm >= 10000
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
    'place:' || p.id
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind IN ('вуз','колледж','нии')
ORDER BY 1, 4 DESC NULLS LAST;

-- Средние БЦ 5–10к: отдельный лист. Теперь без вычтенных и с учётом Арендатора.
DROP VIEW IF EXISTS vitrina."8 БЦ средние 5-10к";
CREATE VIEW vitrina."8 БЦ средние 5-10к" AS
SELECT o.title AS "Название БЦ",
    vitrina.addr_short(o.address) AS "Адрес",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    o.floors AS "Этажей",
    o.built_year AS "Год постройки",
    CASE
        WHEN o.object_type = 'бц' AND o.arendator_matched THEN 'OSM + Арендатор'
        WHEN o.arendator_matched                          THEN 'Арендатор'
        ELSE 'карты OSM'
    END AS "Подтверждён",
    o.cadastral_no AS "Кадастровый номер"
FROM kosmos.objects o
WHERE o.status NOT LIKE 'вычтен%'
  AND o.annex = 1 AND o.area_sqm >= 5000 AND o.area_sqm < 10000
  AND (o.object_type = 'бц' OR o.arendator_matched)
ORDER BY o.area_sqm DESC;
