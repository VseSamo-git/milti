-- Подтверждение БЦ каталогом arendator.ru + чистка «проверить» геометрией.
--
-- ПОЧЕМУ. Обогащение вытащило площади, и в «проверить профиль» листа 1
-- набралось ~1400 зданий реестра ≥10к — среди них настоящие БЦ вперемешку
-- со складами/промкой (реестр 700-ПП ловит любой крупный нежилой объект).
-- Курированный каталог Арендатора (782 БЦ) подтверждает по координатам ~600
-- из них как настоящие БЦ — это надёжнее геометрии. Остаток режем геометрией
-- офиса (площадь/этаж ≤ 3000 = офис, шире = склад/молл), как в листе 2.
--
-- Метка Арендатора — в ОТДЕЛЬНЫХ колонках, не в object_type: пересборка
-- OSM/супермаркетов не должна её затирать. Провенанс = url Арендатора.

ALTER TABLE kosmos.objects
  ADD COLUMN IF NOT EXISTS arendator_matched boolean,
  ADD COLUMN IF NOT EXISTS arendator_dist_m  numeric,
  ADD COLUMN IF NOT EXISTS arendator_url     text;

DROP VIEW IF EXISTS vitrina."1 БЦ Москвы";
CREATE VIEW vitrina."1 БЦ Москвы" AS
SELECT o.title AS "Название БЦ",
    vitrina.addr_short(o.address) AS "Адрес",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    o.floors AS "Этажей",
    o.built_year AS "Год постройки",
    CASE
        WHEN o.object_type = 'бц' OR o.arendator_matched THEN 'БЦ подтверждён'
        WHEN o.floors IS NULL OR o.floors = 0            THEN 'проверить: этажность неизвестна'
        WHEN o.area_sqm / o.floors <= 3000               THEN 'проверить: похоже на офис'
        ELSE 'проверить: широкое (склад/молл)'
    END AS "Профиль",
    CASE
        WHEN o.object_type = 'бц' AND o.arendator_matched THEN 'OSM + Арендатор'
        WHEN o.arendator_matched                          THEN 'Арендатор'
        WHEN o.object_type = 'бц'                         THEN 'карты OSM'
        ELSE '—'
    END AS "Подтверждён",
    CASE
        WHEN o.title_distance_m <= 15 THEN 'название точное'
        WHEN o.title_distance_m <= 30 THEN 'название скорее верное'
        WHEN o.title IS NULL          THEN 'название неизвестно'
        ELSE 'название проверить'
    END AS "Достоверность названия",
    CASE o.status
        WHEN 'вычтен' THEN 'наша точка уже есть'
        ELSE 'в работе'
    END AS "Статус",
    o.cadastral_no AS "Кадастровый номер"
FROM kosmos.objects o
WHERE o.annex = 1
  AND o.area_sqm >= 10000
  AND (
    o.object_type = 'бц'
    OR o.arendator_matched
    OR (
      o.object_type = 'неизвестен'
      AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)')
    )
  )
ORDER BY (NOT (o.object_type = 'бц' OR o.arendator_matched)), o.area_sqm DESC;
