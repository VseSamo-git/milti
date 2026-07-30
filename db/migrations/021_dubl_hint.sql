-- Флаг «возможно уже в Базе» для очереди «На проверку».
--
-- Один физический комплекс живёт в базе несколькими строками: дробление
-- кадастра (корпус/строение) + внешний каталог. Порог дедупа по координате
-- ≤50 м их не всегда ловит (центроиды крупных комплексов расходятся на 100+ м,
-- адрес пишут как «16» против «16/1»). Точные дубли убираем (status), а
-- неоднозначные — НЕ прячем, чтобы не потерять отдельное здание в плотном
-- кластере (Королёва 13: «Роснефть» и «БЦ Мосавто» — разные здания одного
-- адреса). Вместо этого показываем подсказку, а решает человек.
--
-- Подсказку считает скрипт reconcile_proverka.js и пишет в эту колонку.

ALTER TABLE kosmos.objects ADD COLUMN IF NOT EXISTS baza_dubl_hint TEXT;

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
            AND (o.title IS NULL OR o.title !~* '(торгов|ТРЦ|ТРК|\mТЦ\M|молл|\mmall\M|аутлет|outlet|универмаг|рынок|гипермаркет|ярмарк|вернисаж|shopping|ритейл|автосалон|моторс|мебель|дилерск|аквапарк|пересадочн|вокзал)'))
  )
ORDER BY (o.origin IS NULL), o.area_sqm DESC NULLS LAST;
