-- Непрофильные здания в «Базе»: «Пожарная часть № 14», «отдел ЗАГС» и подобное
-- имеют object_type='бц' по кривым данным источника, а ветка БЦ пускает объекты
-- с площадью NULL — вот гражданские объекты и висели как БЦ. Ретейл-фильтр к
-- ветке БЦ не применялся вовсе.
--
-- Фильтр УЗКИЙ и ТОЛЬКО к объектам-зданиям (origin IS NULL): ВУЗ/Колледж/НИИ
-- живут в kosmos.places (второй SELECT UNION) и НЕ затрагиваются — «Академия
-- противопожарной службы» (ВУЗ), колледжи полиции остаются лидами. «котельн»
-- намеренно НЕ включён — ловил бы фамилию «Котельникова» (Институт РАН).

CREATE OR REPLACE VIEW vitrina."База" AS
 SELECT vitrina.tip_obekta(o.object_type, o.arendator_matched) AS "Тип объекта",
    COALESCE(o.title, '(без названия)') AS "Название",
    vitrina.addr_short(o.address) AS "Адрес",
    round(o.area_sqm)::integer AS "Площадь, м²",
    o.floors AS "Этажей",
    (o.lat || ', ') || o.lon AS "Координаты",
        CASE
            WHEN o.object_type = 'бц' AND o.arendator_matched THEN 'OSM + Арендатор'
            WHEN o.arendator_matched THEN 'Арендатор'
            WHEN o.object_type = 'бц' THEN 'карты OSM'
            WHEN o.origin IS NOT NULL THEN 'внешний, одобрен'
            WHEN o.floors > 0 AND (o.area_sqm / o.floors::numeric) <= 3000 THEN 'офисная геометрия'
            ELSE '—'
        END AS "Подтверждён",
        CASE WHEN o.origin IS NULL THEN 'реестр 700-ПП' ELSE o.origin END AS "Источник",
    o.cadastral_no AS "Ключ"
   FROM kosmos.objects o
     LEFT JOIN vitrina._last_verdict v ON v.object_id = o.id
  WHERE o.status !~~ 'вычтен%' AND (v.verdict IS NULL OR v.verdict <> 'отказ')
    AND (
      (o.origin IS NULL
        AND (o.title IS NULL OR o.title !~* '(пожарн|\mЗАГС\M|\mМВД\M|\mУВД\M|\mОВД\M|отдел полиции|подстанц|поликлиник|амбулатор|диспансер|военкомат|кладбищ|крематор|тюрьм|\mСИЗО\M)')
        AND (
          (o.object_type = 'бц' OR o.arendator_matched) AND (o.arendator_matched OR o.area_sqm >= 10000 OR o.area_sqm IS NULL)
          OR (o.object_type = ANY (ARRAY['офисное_здание','офис_компании']))
          OR o.object_type = 'неизвестен' AND NOT COALESCE(o.arendator_matched, false) AND o.annex = 1 AND o.area_sqm >= 10000 AND o.floors > 0 AND (o.area_sqm / o.floors::numeric) <= 3000
             AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)')
        ))
      OR (o.origin IS NOT NULL AND v.verdict = 'интересно')
    )
UNION ALL
 SELECT
        CASE p.kind WHEN 'вуз' THEN 'ВУЗ' WHEN 'колледж' THEN 'Колледж' ELSE 'НИИ' END AS "Тип объекта",
    COALESCE(p.name, '(без названия)') AS "Название",
    COALESCE(vitrina.addr_short(p.address), vitrina.addr_short(o.address)) AS "Адрес",
    round(o.area_sqm)::integer AS "Площадь, м²",
    o.floors AS "Этажей",
    (p.lat || ', ') || p.lon AS "Координаты",
    'OSM' AS "Подтверждён",
    'OSM' AS "Источник",
    'place:' || p.id AS "Ключ"
   FROM kosmos.places p
     LEFT JOIN kosmos.objects o ON o.id = p.object_id
  WHERE p.kind = ANY (ARRAY['вуз','колледж','нии'])
  ORDER BY 1, 4 DESC NULLS LAST;

-- «На проверку»: тот же непрофильный фильтр к реестровой ветке.
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
    o.baza_dubl_hint                                            AS "Возможно уже в Базе",
    NULL::text                                                  AS "Решение (ОК / Хуй)",
    o.cadastral_no                                              AS "Ключ"
FROM kosmos.objects o
LEFT JOIN vitrina._last_verdict v ON v.object_id = o.id
WHERE o.status = 'активен'
  AND v.verdict IS NULL
  AND (
        o.origin IS NOT NULL
        OR (o.origin IS NULL AND o.object_type = 'неизвестен' AND o.annex = 1
            AND o.area_sqm >= 10000
            AND (o.floors IS NULL OR o.floors = 0 OR o.area_sqm / o.floors > 3000)
            AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)')
            AND (o.title IS NULL OR o.title !~* '(пожарн|\mЗАГС\M|\mМВД\M|\mУВД\M|\mОВД\M|отдел полиции|подстанц|поликлиник|амбулатор|диспансер|военкомат|кладбищ|крематор|тюрьм|\mСИЗО\M)'))
  )
ORDER BY (o.origin IS NULL), o.area_sqm DESC NULLS LAST;
