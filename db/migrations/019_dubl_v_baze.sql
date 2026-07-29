-- Статус «дубль_в_базе»: объект «На проверку», чей адрес/координата совпали
-- с уже существующим лидом «Базы» (другой кадастр того же комплекса).
-- Проверять его не нужно — здание уже в работе. В БД остаётся (обратимо).

ALTER TABLE kosmos.objects DROP CONSTRAINT valid_status;
ALTER TABLE kosmos.objects ADD CONSTRAINT valid_status CHECK (status IN (
    'активен', 'не_найден_в_последнем_обходе',
    'вычтен_наша_точка', 'вычтен_закрытая_точка',
    'дубль_в_базе'
));

-- «На проверку» теперь показывает только живые (status='активен'): так уходят
-- и вычтенные точки, и дубли Базы — одним предикатом.
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
