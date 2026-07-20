-- Правки по замечаниям Димы, снятым с живой витрины.
--
-- 1. ТЦ теперь определяется наличием продуктового внутри, а не словом
--    в названии. В список больше не попадут «Тойота-лексус ВДНХ» и
--    «Мебель Сити»: у автосалона нет Пятёрочки.
--
-- 2. Даты выводятся строкой ДД.ММ.ГГГГ. Раньше в витрину уезжал
--    ISO-таймстамп «2026-07-20T00:00:00.000Z» — Диме такое читать нечем.
--
-- 3. У НИИ и ВУЗов появился адрес: 435 из 472 и 348 из 364 против 140
--    и 108 раньше. Колонка «Координаты» убрана из первого ряда — она
--    была костылём на время отсутствия адресов.

DROP VIEW IF EXISTS vitrina."6 ТЦ с супермаркетом";
CREATE VIEW vitrina."6 ТЦ с супермаркетом" AS
SELECT
    coalesce(o.title, o.address)         AS "Название ТЦ",
    o.address                            AS "Адрес",
    o.supermarkets                       AS "Продуктовый супермаркет",
    round(o.area_sqm)::int               AS "Общая площадь, м²",
    o.floors                             AS "Этажей",
    o.cadastral_no                       AS "Кадастровый номер"
FROM kosmos.objects o
WHERE o.object_type = 'тц'
ORDER BY o.area_sqm DESC NULLS LAST;

DROP VIEW IF EXISTS vitrina."4 НИИ";
CREATE VIEW vitrina."4 НИИ" AS
SELECT
    p.name                                                   AS "Название НИИ",
    p.address                                                AS "Адрес",
    CASE
        WHEN p.address IS NULL              THEN 'адрес не найден'
        WHEN p.address_distance_m IS NULL   THEN 'адрес из источника'
        WHEN p.address_distance_m <= 30     THEN 'адрес точный'
        ELSE 'адрес проверить'
    END                                                      AS "Достоверность адреса",
    round(o.area_sqm)::int                                   AS "Общая площадь, м²",
    to_char(p.first_seen_at, 'DD.MM.YYYY')                   AS "Добавлен",
    p.lat || ', ' || p.lon                                   AS "Координаты"
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind = 'нии'
ORDER BY p.name;

DROP VIEW IF EXISTS vitrina."5 ВУЗы";
CREATE VIEW vitrina."5 ВУЗы" AS
SELECT
    p.name                                                   AS "Название",
    CASE p.kind WHEN 'вуз' THEN 'ВУЗ' ELSE 'колледж' END     AS "Тип",
    p.address                                                AS "Адрес",
    CASE
        WHEN p.address IS NULL              THEN 'адрес не найден'
        WHEN p.address_distance_m IS NULL   THEN 'адрес из источника'
        WHEN p.address_distance_m <= 30     THEN 'адрес точный'
        ELSE 'адрес проверить'
    END                                                      AS "Достоверность адреса",
    round(o.area_sqm)::int                                   AS "Общая площадь, м²",
    p.students                                               AS "Студентов по адресу",
    p.lat || ', ' || p.lon                                   AS "Координаты"
FROM kosmos.places p
LEFT JOIN kosmos.objects o ON o.id = p.object_id
WHERE p.kind IN ('вуз', 'колледж')
ORDER BY p.kind, p.name;

DROP VIEW IF EXISTS vitrina."7 Конкуренты";
CREATE VIEW vitrina."7 Конкуренты" AS
SELECT
    p.chain                                                  AS "Сеть",
    coalesce(p.address, nullif(trim(coalesce(p.street, '') || ' ' || coalesce(p.house, '')), ''))
                                                             AS "Адрес",
    CASE p.status
        WHEN 'активна'              THEN 'работает'
        WHEN 'кандидат_на_закрытие' THEN 'возможно закрылась'
        ELSE p.status
    END                                                      AS "Статус",
    to_char(p.first_seen_at, 'DD.MM.YYYY')                   AS "Впервые увидели",
    to_char(p.last_seen_at, 'DD.MM.YYYY')                    AS "Последний раз видели",
    p.source                                                 AS "Источник"
FROM kosmos.places p
WHERE p.kind = 'конкурент'
ORDER BY p.chain, p.address;
