-- 026 — ОДОБРЕНИЕ ДИМЫ СИЛЬНЕЕ ФОРМАЛЬНЫХ КРИТЕРИЕВ.
--
-- Найдено 18.08.2026 проверкой «а доехали ли до Базы те строки, которые Дима
-- перенёс?». Из 89 одобренных в Базе было видно 25.
--
-- ПРИЧИНА. Вью учитывала вердикт 'интересно' ТОЛЬКО для объектов из внешних
-- каталогов: условие было `o.origin IS NOT NULL AND v.verdict = 'интересно'`.
-- Для объектов из реестра (origin IS NULL) одобрение не значило ничего — они
-- проходили только по формальным критериям (тип, площадь, этажность). Но в
-- очередь «На проверку» объект и попадает именно потому, что по критериям не
-- проходит. Замкнутый круг: Дима жмёт ОК, объект остаётся невидимым.
--
-- Так потерялись 58 объектов, и это не мусор: ЦУМ (56 779 м²), Росатом
-- (42 343 м²), Лотте Плаза (53 737 м²), ЛУКОЙЛ (46 786 м²), Цветной (36 522 м²).
--
-- ИСПРАВЛЕНИЕ. Условие становится `v.verdict = 'интересно'` без оглядки на
-- origin: человек сказал «беру» — объект в Базе. Это ровно то, что обещано
-- Диме в §6 п.9 карты: ОК в очереди — объект уезжает в Базу.
--
-- ЗАМЕЧЕННЫЙ КОНФЛИКТ, НЕ РЕШЁННЫЙ ЗДЕСЬ. Шесть объектов Дима одобрил ДО того,
-- как 18.08 сказал «подмосковье нахуй удаляй»: Бизнес-парк Химки (130 000 м²),
-- Khimki ONE, aero siti, Сколково, БЦ Кубик, Riga Land. Позднее указание общее
-- и категоричное, поэтому они остаются вычтенными — но это его два решения
-- друг против друга, и спросить надо человека, а не выбирать за него.

BEGIN;

CREATE OR REPLACE VIEW vitrina."База" AS SELECT vitrina.tip_obekta(o.object_type, o.arendator_matched) AS "Тип объекта",
    COALESCE(o.title, '(без названия)'::text) AS "Название",
    vitrina.addr_short(o.address) AS "Адрес",
    round(o.area_sqm)::integer AS "Площадь, м²",
    o.floors AS "Этажей",
    (o.lat || ', '::text) || o.lon AS "Координаты",
        CASE
            WHEN o.object_type = 'бц'::text AND o.arendator_matched THEN 'OSM + Арендатор'::text
            WHEN o.arendator_matched THEN 'Арендатор'::text
            WHEN o.object_type = 'бц'::text THEN 'карты OSM'::text
            WHEN o.origin IS NOT NULL THEN 'внешний, одобрен'::text
            WHEN o.floors > 0 AND (o.area_sqm / o.floors::numeric) <= 3000::numeric THEN 'офисная геометрия'::text
            ELSE '—'::text
        END AS "Подтверждён",
        CASE
            WHEN o.origin IS NULL THEN 'реестр 700-ПП'::text
            ELSE o.origin
        END AS "Источник",
    NULL::text AS "Решение (ОК / Хуй)",
    o.cadastral_no AS "Ключ"
   FROM kosmos.objects o
     LEFT JOIN vitrina._last_verdict v ON v.entity_key = o.cadastral_no
  WHERE o.status = 'активен'::text AND (v.verdict IS NULL OR v.verdict <> 'отказ'::text) AND (o.origin IS NULL AND ((o.object_type = 'бц'::text OR o.arendator_matched) AND (o.arendator_matched OR o.area_sqm >= 10000::numeric OR o.area_sqm IS NULL) OR (o.object_type = ANY (ARRAY['офисное_здание'::text, 'офис_компании'::text])) OR o.object_type = 'неизвестен'::text AND o.annex = 1 AND o.area_sqm >= 10000::numeric AND o.floors > 0 AND (o.area_sqm / o.floors::numeric) <= 3000::numeric AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)'::text)) OR v.verdict IS NOT NULL AND v.verdict = 'интересно'::text)
UNION ALL
 SELECT
        CASE p.kind
            WHEN 'вуз'::text THEN 'ВУЗ'::text
            WHEN 'колледж'::text THEN 'Колледж'::text
            ELSE 'НИИ'::text
        END AS "Тип объекта",
    COALESCE(p.name, '(без названия)'::text) AS "Название",
    COALESCE(vitrina.addr_short(p.address), vitrina.addr_short(o.address)) AS "Адрес",
    round(o.area_sqm)::integer AS "Площадь, м²",
    o.floors AS "Этажей",
    (p.lat || ', '::text) || p.lon AS "Координаты",
    'OSM'::text AS "Подтверждён",
    'OSM'::text AS "Источник",
    NULL::text AS "Решение (ОК / Хуй)",
    'place:'::text || p.id AS "Ключ"
   FROM kosmos.places p
     LEFT JOIN kosmos.objects o ON o.id = p.object_id
     LEFT JOIN vitrina._last_verdict v ON v.entity_key = ('place:'::text || p.id)
  WHERE (p.kind = ANY (ARRAY['вуз'::text, 'колледж'::text, 'нии'::text])) AND p.status = 'активна'::text AND (v.verdict IS NULL OR v.verdict <> 'отказ'::text)
  ORDER BY 1, 4 DESC NULLS LAST;

COMMIT;
