-- Короткий адрес для витрины: убрать канцелярский префикс ЕГРН.
--
-- Дима просит: «оставь только город и адрес, а для Москвы — просто адрес».
-- В ЕГРН адрес приходит как
--   «Российская Федерация, город Москва, вн.тер.г. муниципальный округ
--    Дмитровский, улица Софьи Ковалевской, дом 1»
-- — четыре слова из пяти лишние. Режем:
--   1. страну «Российская Федерация»;
--   2. город «Москва» (только Москву! Мытищи, Путилково и пр. оставляем —
--      для области город — это как раз то, что нужно видеть);
--   3. «вн.тер.г. … округ/поселение» — административную единицу.
-- Улицу и дом не трогаем.
--
-- ПОЧЕМУ ФУНКЦИЯ, А НЕ UPDATE. Сырой адрес не портим: воскресный конвейер
-- перезальёт его из ЕГРН, и любая правка столбца отменится. Чистим в слое
-- витрины — вью всегда показывает короткий, а первоисточник цел.
--
-- ЯКОРЬ ^. Удаляем «Москва» только в начале строки, поэтому улица вроде
-- «Москворечье» или «площадь Москвы» уцелеет — там «Москва» не в начале.

CREATE OR REPLACE FUNCTION vitrina.addr_short(a text) RETURNS text AS $$
  SELECT nullif(
    btrim(
      regexp_replace(                                    -- 3) вн.тер.г. … ,
        regexp_replace(                                  -- 2) город Москва ,
          regexp_replace(                                -- 1) Российская Федерация ,
            coalesce(a, ''),
            '^\s*Российская Федерация\s*,\s*', '', 'i'),
          '^\s*((город\s+Москва|г\.?\s*Москва|Москва)\s*,\s*)+', '', 'i'),
        '^\s*вн\.тер\.г\.\s*[^,]*,\s*', '', 'i'),
      ' ,'),
    '');
$$ LANGUAGE sql IMMUTABLE;

COMMENT ON FUNCTION vitrina.addr_short IS
  'Короткий адрес для витрины: снимает РФ / город Москва / вн.тер.г.-округ, область оставляет.';

-- Пересобираем вью, оборачивая адресную колонку. Остальная логика — как была.

DROP VIEW IF EXISTS vitrina."1 БЦ Москвы";
CREATE VIEW vitrina."1 БЦ Москвы" AS
SELECT o.title AS "Название БЦ",
    vitrina.addr_short(o.address) AS "Адрес",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    o.floors AS "Этажей",
    o.built_year AS "Год постройки",
    CASE
        WHEN o.title_distance_m <= 15 THEN 'название точное'
        WHEN o.title_distance_m <= 30 THEN 'название скорее верное'
        ELSE 'название проверить'
    END AS "Достоверность названия",
    CASE o.status
        WHEN 'вычтен' THEN 'наша точка уже есть'
        ELSE 'в работе'
    END AS "Статус",
    o.cadastral_no AS "Кадастровый номер"
FROM kosmos.objects o
WHERE o.annex = 1 AND o.area_sqm >= 10000 AND o.object_type = 'бц'
ORDER BY o.area_sqm DESC;

DROP VIEW IF EXISTS vitrina."2 Офисные здания";
CREATE VIEW vitrina."2 Офисные здания" AS
SELECT vitrina.addr_short(o.address) AS "Адрес",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    o.floors AS "Этажей",
    CASE
        WHEN o.floors IS NULL OR o.floors = 0 THEN 'этажность неизвестна'
        WHEN o.area_sqm / o.floors <= 3000 THEN 'похоже на офисное'
        ELSE 'проверить: широкое здание'
    END AS "Профиль",
    o.org_count AS "Организаций в здании",
    o.built_year AS "Год постройки",
    o.cadastral_no AS "Кадастровый номер"
FROM kosmos.objects o
WHERE o.annex = 1 AND o.area_sqm >= 10000 AND o.title IS NULL AND o.supermarkets IS NULL
  AND (o.floors IS NULL OR o.floors = 0 OR o.area_sqm / o.floors < 8000)
ORDER BY o.area_sqm DESC;

DROP VIEW IF EXISTS vitrina."3 Офисы компаний";
CREATE VIEW vitrina."3 Офисы компаний" AS
SELECT f.name AS "Название компании",
    vitrina.addr_short(o.address) AS "Адрес",
    o.title AS "Здание",
    round(o.area_sqm)::integer AS "Площадь здания, м²",
    o.org_count AS "Организаций в здании",
    o.floors AS "Этажей",
    CASE
        WHEN f.distance_m <= 15 THEN 'привязка точная'
        WHEN f.distance_m <= 30 THEN 'привязка скорее верная'
        ELSE 'привязку проверить'
    END AS "Достоверность",
    o.cadastral_no AS "Кадастровый номер"
FROM kosmos.offices f
JOIN kosmos.objects o ON o.id = f.object_id
WHERE o.area_sqm >= 5000
ORDER BY o.area_sqm DESC;

DROP VIEW IF EXISTS vitrina."4 НИИ";
CREATE VIEW vitrina."4 НИИ" AS
SELECT p.name AS "Название НИИ",
    vitrina.addr_short(p.address) AS "Адрес",
    CASE
        WHEN p.address IS NULL THEN 'адрес не найден'
        WHEN p.address_distance_m IS NULL THEN 'адрес из источника'
        WHEN p.address_distance_m <= 30 THEN 'адрес точный'
        ELSE 'адрес проверить'
    END AS "Достоверность адреса",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    to_char(p.first_seen_at, 'DD.MM.YYYY') AS "Добавлен",
    p.lat || ', ' || p.lon AS "Координаты"
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind = 'нии'
ORDER BY p.name;

DROP VIEW IF EXISTS vitrina."5 ВУЗы";
CREATE VIEW vitrina."5 ВУЗы" AS
SELECT p.name AS "Название",
    CASE p.kind WHEN 'вуз' THEN 'ВУЗ' ELSE 'колледж' END AS "Тип",
    vitrina.addr_short(p.address) AS "Адрес",
    CASE
        WHEN p.address IS NULL THEN 'адрес не найден'
        WHEN p.address_distance_m IS NULL THEN 'адрес из источника'
        WHEN p.address_distance_m <= 30 THEN 'адрес точный'
        ELSE 'адрес проверить'
    END AS "Достоверность адреса",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    p.students AS "Студентов по адресу",
    p.lat || ', ' || p.lon AS "Координаты"
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind IN ('вуз', 'колледж')
ORDER BY p.kind, p.name;

DROP VIEW IF EXISTS vitrina."6 ТЦ с супермаркетом";
CREATE VIEW vitrina."6 ТЦ с супермаркетом" AS
SELECT COALESCE(o.title, vitrina.addr_short(o.address)) AS "Название ТЦ",
    vitrina.addr_short(o.address) AS "Адрес",
    o.supermarkets AS "Продуктовый супермаркет",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    o.floors AS "Этажей",
    o.cadastral_no AS "Кадастровый номер"
FROM kosmos.objects o
WHERE o.object_type = 'тц'
ORDER BY o.area_sqm DESC NULLS LAST;

DROP VIEW IF EXISTS vitrina."7 Конкуренты";
CREATE VIEW vitrina."7 Конкуренты" AS
SELECT p.chain AS "Сеть",
    vitrina.addr_short(
        COALESCE(p.address, NULLIF(TRIM(COALESCE(p.street, '') || ' ' || COALESCE(p.house, '')), ''))
    ) AS "Адрес",
    CASE p.status
        WHEN 'активна' THEN 'работает'
        WHEN 'кандидат_на_закрытие' THEN 'возможно закрылась'
        ELSE p.status
    END AS "Статус",
    CASE
        WHEN p.source = 'osm_secondary' THEN 'OpenStreetMap — выборка, неполно'
        ELSE 'store-locator сети — полно'
    END AS "Источник",
    to_char(p.first_seen_at, 'DD.MM.YYYY') AS "Впервые увидели",
    to_char(p.last_seen_at, 'DD.MM.YYYY') AS "Последний раз видели"
FROM kosmos.places p
WHERE p.kind = 'конкурент'
ORDER BY p.chain, p.address NULLS LAST;
