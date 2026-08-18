-- 027 — ОТМЕТКА «ОК» ПЕРЕЖИВАЕТ ПЕРЕСБОРКУ.
--
-- Колонка «Решение (ОК / Хуй)» отдавалась как NULL, и после каждой ночной
-- пересборки все 1 897 строк «Базы» показывались Диме без единой отметки.
--
-- Для очереди «На проверку» это незаметно: решил — строка уехала. А в самой
-- «Базе» ОК означает «проверено, оставить» (§6 п.9 карты), и стирание следа
-- means, что проверенное не отличить от непроверенного: Дима разбирает одно
-- и то же по кругу и не видит, где остановился.
--
-- Теперь колонка показывает последний вердикт: 'интересно' → «ОК».
-- «Хуй» в ней не появится никогда — отклонённая строка исчезает из листа,
-- показывать отметку не на чем.
--
-- Обратный синк от этого не зациклится: sync_verdicts сравнивает решение с
-- последним вердиктом и одинаковое не пишет (дедуп был там с самого начала).
-- Значит, прочитав собственную отметку, он ничего не запишет.

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
    CASE WHEN v.verdict = 'интересно' THEN 'ОК'::text ELSE NULL::text END AS "Решение (ОК / Хуй)",
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
    CASE WHEN v.verdict = 'интересно' THEN 'ОК'::text ELSE NULL::text END AS "Решение (ОК / Хуй)",
    'place:'::text || p.id AS "Ключ"
   FROM kosmos.places p
     LEFT JOIN kosmos.objects o ON o.id = p.object_id
     LEFT JOIN vitrina._last_verdict v ON v.entity_key = ('place:'::text || p.id)
  WHERE (p.kind = ANY (ARRAY['вуз'::text, 'колледж'::text, 'нии'::text])) AND p.status = 'активна'::text AND (v.verdict IS NULL OR v.verdict <> 'отказ'::text)
  ORDER BY 1, 4 DESC NULLS LAST;

CREATE OR REPLACE VIEW vitrina."На проверку" AS SELECT
        CASE
            WHEN o.origin IS NOT NULL THEN 'внешний БЦ'::text
            ELSE 'реестр: профиль неясен'::text
        END AS "Что это",
    COALESCE(o.title, '(без названия)'::text) AS "Название",
    vitrina.addr_short(o.address) AS "Адрес",
    round(o.area_sqm)::integer AS "Площадь, м²",
    o.floors AS "Этажей",
    (o.lat || ', '::text) || o.lon AS "Координаты",
        CASE
            WHEN o.origin IS NOT NULL THEN COALESCE(o.origin, ''::text) || ' (каталог, не проверен)'::text
            WHEN o.floors IS NULL OR o.floors = 0 THEN 'этажность неизвестна'::text
            WHEN (o.area_sqm / o.floors::numeric) > 3000::numeric THEN 'широкое: склад/молл?'::text
            ELSE 'проверить'::text
        END AS "Почему на проверке",
    o.baza_dubl_hint AS "Возможно уже в Базе",
    CASE WHEN v.verdict = 'интересно' THEN 'ОК'::text ELSE NULL::text END AS "Решение (ОК / Хуй)",
    o.cadastral_no AS "Ключ"
   FROM kosmos.objects o
     LEFT JOIN vitrina._last_verdict v ON v.entity_key = o.cadastral_no
  WHERE o.status = 'активен'::text AND v.verdict IS NULL AND (o.origin IS NOT NULL OR o.origin IS NULL AND o.object_type = 'неизвестен'::text AND o.annex = 1 AND o.area_sqm >= 10000::numeric AND (o.floors IS NULL OR o.floors = 0 OR (o.area_sqm / o.floors::numeric) > 3000::numeric) AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)'::text))
  ORDER BY (o.origin IS NULL), o.area_sqm DESC NULLS LAST;

CREATE OR REPLACE VIEW vitrina."ТЦ с супермаркетом" AS SELECT COALESCE(o.title, vitrina.addr_short(o.address)) AS "Название ТЦ",
    vitrina.addr_short(o.address) AS "Адрес",
    o.supermarkets AS "Продуктовый супермаркет",
    round(o.area_sqm)::integer AS "Общая площадь, м²",
    o.floors AS "Этажей",
    CASE WHEN v.verdict = 'интересно' THEN 'ОК'::text ELSE NULL::text END AS "Решение (ОК / Хуй)",
    o.cadastral_no AS "Ключ"
   FROM kosmos.objects o
     LEFT JOIN vitrina._last_verdict v ON v.entity_key = o.cadastral_no
  WHERE o.object_type = 'тц'::text AND o.status = 'активен'::text AND (v.verdict IS NULL OR v.verdict <> 'отказ'::text)
  ORDER BY o.area_sqm DESC NULLS LAST;

CREATE OR REPLACE VIEW vitrina."Конкуренты" AS SELECT p.chain AS "Сеть",
    vitrina.addr_short(COALESCE(p.address, NULLIF(btrim((COALESCE(p.street, ''::text) || ' '::text) || COALESCE(p.house, ''::text)), ''::text))) AS "Адрес",
        CASE p.status
            WHEN 'активна'::text THEN 'работает'::text
            WHEN 'кандидат_на_закрытие'::text THEN 'возможно закрылась'::text
            ELSE p.status
        END AS "Статус",
        CASE
            WHEN p.source = 'osm_secondary'::text THEN 'OpenStreetMap — выборка, неполно'::text
            ELSE 'store-locator сети — полно'::text
        END AS "Источник",
    to_char(p.first_seen_at, 'DD.MM.YYYY'::text) AS "Впервые увидели",
    to_char(p.last_seen_at, 'DD.MM.YYYY'::text) AS "Последний раз видели",
    CASE WHEN v.verdict = 'интересно' THEN 'ОК'::text ELSE NULL::text END AS "Решение (ОК / Хуй)",
    'place:'::text || p.id AS "Ключ"
   FROM kosmos.places p
     LEFT JOIN vitrina._last_verdict v ON v.entity_key = ('place:'::text || p.id)
  WHERE p.kind = 'конкурент'::text AND (p.status = ANY (ARRAY['активна'::text, 'кандидат_на_закрытие'::text])) AND (v.verdict IS NULL OR v.verdict <> 'отказ'::text)
  ORDER BY p.chain, p.address;

COMMIT;
