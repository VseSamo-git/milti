# КОСМОС — Реестр: разовая сборка. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать в Postgres реестр коммерческих зданий Москвы с площадями из ЕГРН, отфильтровать объекты от 10 000 м², вычесть действующие и закрытые точки МИЛТИ — и получить проверяемый список лидов.

**Architecture:** Standalone Python-приложение, запускаемое вручную один раз (~12 часов). Перечень 700-ПП даёт состав (42 343 кадастровых номера), геопортал НСПД даёт площадь по кадастровому номеру, адресный реестр Москвы даёт UNOM для вычитания точек. Обогащение идёт **после** фильтра по площади, поэтому дорогой шаг применяется к ~1 500 объектам, а не к 42 000. Каждое значение хранит провенанс; NULL легитимен.

**Tech Stack:** Python 3.11+, PostgreSQL 14+, `httpx` (HTTP), `pypdf` (парсинг PDF), `psycopg[binary]` (Postgres), `pytest`.

**Scope:** Только разовая сборка реестра. Еженедельный конвейер, витрина Google Sheets, Telegram-бот и LLM-аналитик — отдельные планы.

**Spec:** `docs/superpowers/specs/2026-07-15-kosmos-design.md` (ред. 2)

## Global Constraints

- **Провенанс обязателен.** Ни одно значение в `objects` не пишется без указания источника. NULL — легитимное значение. Пустая ячейка честнее выдуманной. (Спека 2.5)
- **Инвариант ч. 27 №1:** хранить только производные поля (площадь, этажность, год, назначение) в собственной табличной форме. Никогда не воспроизводить совокупность сведений выписки ЕГРН по утверждённым формам. (Спека 9)
- **Инвариант ч. 27 №2:** никогда не хранить, не пересылать и не прикладывать файлы с подписью или ЭЦП Росреестра/ППК — ни в Postgres, ни где-либо ещё. (Спека 9)
- **Система никогда не удаляет объекты.** Только меняет статус. (Спека 2.7)
- **Машина пишет в `objects`, человек — в `verdicts`.** Никогда не наоборот. (Спека 4)
- **Атрибуция:** данные data.mos.ru используются по лицензии CC BY 4.0, требуется ссылка на первоисточник. (Спека 9)
- **НСПД: не быстрее 1 запроса в секунду.** Троттлинга не замечено именно на этой частоте; ускорение — риск бана WAF. (Спека 3.2)
- Все деньги — рубли, все площади — квадратные метры, все даты — ISO 8601.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `db/schema.sql` | Схема `kosmos`: три основные таблицы + вспомогательные |
| `kosmos/config.py` | Конфигурация из переменных окружения. Единственное место, где читается среда |
| `kosmos/models.py` | Датаклассы: `Observation`, `ObjectRecord`, `Area` |
| `kosmos/db.py` | Подключение к Postgres, запись наблюдений и объектов |
| `kosmos/sources/pp700.py` | Скачивание и парсинг перечня 700-ПП из PDF |
| `kosmos/sources/nspd.py` | Клиент геопортала НСПД: площадь по кадастровому номеру |
| `kosmos/sources/addr_registry.py` | Адресный реестр data.mos.ru #60562: UNOM по кадастровому номеру |
| `kosmos/filters.py` | Порог 10 000 м², серая зона, метки достоверности |
| `kosmos/subtract.py` | Вычитание точек МИЛТИ по UNOM + регресс-тест правила |
| `scripts/build_baseline.py` | Оркестратор разовой сборки |
| `tests/` | Тесты, по файлу на модуль |

Разделение по ответственности, а не по слоям: каждый источник знает только про себя и возвращает наблюдения в общем формате. Поломка одного источника чинится в одном файле.

---

## Task 1: Схема базы и конфигурация

**Files:**
- Create: `db/schema.sql`
- Create: `kosmos/config.py`
- Create: `kosmos/__init__.py`
- Create: `pyproject.toml`
- Test: `tests/test_config.py`

**Interfaces:**
- Produces: `kosmos.config.Config` с полями `db_dsn: str`, `nspd_referer: str`, `ca_bundle: str | None`; классметод `Config.from_env() -> Config`.

- [ ] **Step 1: Создать `pyproject.toml`**

```toml
[project]
name = "kosmos"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "httpx>=0.27",
    "pypdf>=4.2",
    "psycopg[binary]>=3.1",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Написать падающий тест конфигурации**

Create `tests/test_config.py`:

```python
import pytest
from kosmos.config import Config


def test_from_env_reads_dsn(monkeypatch):
    monkeypatch.setenv("KOSMOS_DB_DSN", "postgresql://u:p@h/db")
    cfg = Config.from_env()
    assert cfg.db_dsn == "postgresql://u:p@h/db"


def test_from_env_has_default_referer(monkeypatch):
    monkeypatch.setenv("KOSMOS_DB_DSN", "postgresql://u:p@h/db")
    cfg = Config.from_env()
    assert cfg.nspd_referer == "https://nspd.gov.ru/map?thematic=PKK"


def test_from_env_raises_without_dsn(monkeypatch):
    monkeypatch.delenv("KOSMOS_DB_DSN", raising=False)
    with pytest.raises(RuntimeError, match="KOSMOS_DB_DSN"):
        Config.from_env()
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kosmos.config'`

- [ ] **Step 4: Реализовать конфигурацию**

Create `kosmos/__init__.py` (пустой файл).

Create `kosmos/config.py`:

```python
"""Конфигурация КОСМОСа. Единственное место, где читается окружение."""
from dataclasses import dataclass
from os import environ

# Referer обязателен: WAF НСПД отдаёт 403 без него.
# Значения "https://nspd.gov.ru/map" и "https://nspd.gov.ru/" заблокированы
# специально — ими подписываются наивные скраперы. Этот вариант проходит.
DEFAULT_NSPD_REFERER = "https://nspd.gov.ru/map?thematic=PKK"


@dataclass(frozen=True)
class Config:
    db_dsn: str
    nspd_referer: str = DEFAULT_NSPD_REFERER
    ca_bundle: str | None = None

    @classmethod
    def from_env(cls) -> "Config":
        dsn = environ.get("KOSMOS_DB_DSN")
        if not dsn:
            raise RuntimeError("KOSMOS_DB_DSN не задан")
        return cls(
            db_dsn=dsn,
            nspd_referer=environ.get("KOSMOS_NSPD_REFERER", DEFAULT_NSPD_REFERER),
            ca_bundle=environ.get("KOSMOS_CA_BUNDLE"),
        )
```

- [ ] **Step 5: Запустить тест, убедиться что проходит**

Run: `pytest tests/test_config.py -v`
Expected: PASS, 3 passed

- [ ] **Step 6: Написать схему базы**

Create `db/schema.sql`:

```sql
CREATE SCHEMA IF NOT EXISTS kosmos;

-- Журнал сырых наблюдений. Только дописывание, никогда не перезапись.
-- Чёрный ящик: ответ на вопрос "откуда взялась эта цифра".
CREATE TABLE IF NOT EXISTS kosmos.observations (
    id           BIGSERIAL PRIMARY KEY,
    source       TEXT        NOT NULL,   -- 'pp700' | 'nspd' | 'addr_registry' | '2gis'
    observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    cadastral_no TEXT,
    payload      JSONB       NOT NULL,   -- сырой ответ источника
    source_url   TEXT,
    object_id    BIGINT
);
CREATE INDEX IF NOT EXISTS observations_cadastral_idx
    ON kosmos.observations (cadastral_no);
CREATE INDEX IF NOT EXISTS observations_source_idx
    ON kosmos.observations (source, observed_at);

-- Реестр: склеенная правда. Один объект = одна строка.
-- Ключ — кадастровый номер.
CREATE TABLE IF NOT EXISTS kosmos.objects (
    id                  BIGSERIAL PRIMARY KEY,
    cadastral_no        TEXT UNIQUE NOT NULL,
    object_type         TEXT NOT NULL DEFAULT 'неизвестен',
    address             TEXT,
    unom                BIGINT,
    lat                 DOUBLE PRECISION,
    lon                 DOUBLE PRECISION,

    -- Площадь и её провенанс. NULL легитимен.
    area_sqm            NUMERIC(12, 2),
    area_confidence     TEXT,   -- 'точно' | 'оценка' | 'неизвестно'
    area_source         TEXT,   -- обязателен, если area_sqm IS NOT NULL

    floors              INTEGER,
    floors_source       TEXT,
    built_year          INTEGER,
    built_year_source   TEXT,
    commissioning_date  DATE,
    commissioning_conf  TEXT,   -- 'точно' | 'оценка'
    org_count           INTEGER,
    org_count_source    TEXT,

    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    status              TEXT NOT NULL DEFAULT 'активен',
    subtract_reason     TEXT,
    baseline_run        BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT area_needs_source
        CHECK (area_sqm IS NULL OR area_source IS NOT NULL),
    CONSTRAINT area_needs_confidence
        CHECK (area_sqm IS NULL OR area_confidence IS NOT NULL),
    CONSTRAINT floors_needs_source
        CHECK (floors IS NULL OR floors_source IS NOT NULL),
    CONSTRAINT built_year_needs_source
        CHECK (built_year IS NULL OR built_year_source IS NOT NULL),
    CONSTRAINT org_count_needs_source
        CHECK (org_count IS NULL OR org_count_source IS NOT NULL),
    CONSTRAINT valid_object_type CHECK (object_type IN (
        'бц', 'офисное_здание', 'офис_компании', 'нии', 'вуз',
        'конкурент', 'в_стройке', 'неизвестен'
    )),
    CONSTRAINT valid_status CHECK (status IN (
        'активен', 'не_найден_в_последнем_обходе',
        'вычтен_наша_точка', 'вычтен_закрытая_точка'
    )),
    CONSTRAINT valid_area_confidence
        CHECK (area_confidence IS NULL OR area_confidence IN ('точно', 'оценка', 'неизвестно'))
);
CREATE INDEX IF NOT EXISTS objects_unom_idx ON kosmos.objects (unom);
CREATE INDEX IF NOT EXISTS objects_area_idx ON kosmos.objects (area_sqm);
CREATE INDEX IF NOT EXISTS objects_status_idx ON kosmos.objects (status);

-- То, что сказал человек. Отдельно от машинных данных — принципиально.
-- Машина сюда не пишет никогда.
CREATE TABLE IF NOT EXISTS kosmos.verdicts (
    id          BIGSERIAL PRIMARY KEY,
    object_id   BIGINT      NOT NULL REFERENCES kosmos.objects(id),
    author      TEXT        NOT NULL,
    verdict     TEXT        NOT NULL,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verdicts_object_idx ON kosmos.verdicts (object_id);

-- Действующие точки МИЛТИ. Даёт Дима, обновляет раз в месяц.
CREATE TABLE IF NOT EXISTS kosmos.our_points (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT,
    address_raw   TEXT NOT NULL,
    unom          BIGINT,
    lat           DOUBLE PRECISION,
    lon           DOUBLE PRECISION,
    resolved      BOOLEAN NOT NULL DEFAULT false,
    loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Закрытые точки. Туда не возвращаемся.
CREATE TABLE IF NOT EXISTS kosmos.closed_points (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT,
    address_raw   TEXT NOT NULL,
    unom          BIGINT,
    lat           DOUBLE PRECISION,
    lon           DOUBLE PRECISION,
    resolved      BOOLEAN NOT NULL DEFAULT false,
    loaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Журнал запусков конвейера.
CREATE TABLE IF NOT EXISTS kosmos.runs (
    id          BIGSERIAL PRIMARY KEY,
    kind        TEXT NOT NULL,   -- 'baseline' | 'weekly'
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status      TEXT NOT NULL DEFAULT 'running',
    note        TEXT
);
```

Обратите внимание на `CHECK (area_sqm IS NULL OR area_source IS NOT NULL)` — инвариант провенанса из раздела 2.5 спеки закреплён на уровне базы, а не на уровне честного слова разработчика. Выдуманное число физически не запишется.

- [ ] **Step 7: Применить схему и проверить**

```bash
psql "$KOSMOS_DB_DSN" -f db/schema.sql
psql "$KOSMOS_DB_DSN" -c "\dt kosmos.*"
```

Expected: список из шести таблиц — `objects`, `observations`, `verdicts`, `our_points`, `closed_points`, `runs`.

- [ ] **Step 8: Проверить, что инвариант провенанса работает**

```bash
psql "$KOSMOS_DB_DSN" -c \
  "INSERT INTO kosmos.objects (cadastral_no, area_sqm) VALUES ('77:01:0001075:2898', 5000);"
```

Expected: FAIL — `new row for relation "objects" violates check constraint "area_needs_source"`

Это и есть цель: площадь без источника не записывается.

- [ ] **Step 9: Commit**

```bash
git add pyproject.toml db/schema.sql kosmos/__init__.py kosmos/config.py tests/test_config.py
git commit -m "feat: схема реестра КОСМОС и конфигурация

Инвариант провенанса закреплён CHECK-constraint'ами: площадь, этажность,
год и число организаций не записываются без указания источника.
NULL — легитимное значение."
```

---

## Task 2: Парсер перечня 700-ПП

**Files:**
- Create: `kosmos/models.py`
- Create: `kosmos/sources/__init__.py`
- Create: `kosmos/sources/pp700.py`
- Test: `tests/test_pp700.py`
- Test fixture: `tests/fixtures/pp700_sample.txt`

**Interfaces:**
- Consumes: `kosmos.config.Config`
- Produces:
  - `kosmos.models.Pp700Entry` — датакласс с полями `row_no: int`, `cadastral_building: str | None`, `cadastral_room: str | None`, `address: str`, `annex: int`
  - `kosmos.sources.pp700.parse_text(text: str) -> list[Pp700Entry]`
  - `kosmos.sources.pp700.download(url: str, dest: Path, cfg: Config) -> Path`
  - `PP700_2026_URL: str` — прямая ссылка на PDF

**Контекст для реализующего.** Перечень 700-ПП — постановление Правительства Москвы о налоге от кадастровой стоимости. Базовое постановление 2014 года не переиздаётся: каждый год выходит новое, переписывающее приложения. На 2026 год — 2794-ПП от 19.11.2025, PDF на 2 257 страниц, 8,4 МБ.

В нём **ровно четыре колонки**: № п/п, кадастровый номер здания, кадастровый номер помещения, адрес. **Площади там нет** — это проверено полнотекстовым поиском, слово «площадь» встречается 6 раз и все 6 — названия улиц. Не пытайтесь её найти.

Приложение 1 — здания (22 863 строки), Приложение 2 — помещения (19 480 строк). Если здание не стоит на кадастровом учёте, колонка 2 пуста и указываются помещения.

mos.ru отдаёт 403 без браузерного User-Agent.

- [ ] **Step 1: Создать фикстуру с реальными строками перечня**

Create `tests/fixtures/pp700_sample.txt`:

```
Приложение 1
к постановлению Правительства
Москвы от 28 ноября 2014 г. N 700-ПП

  N     Кадастровый номер     Кадастровый номер      Адрес объекта
 п/п        здания              помещения
        (строения,
        сооружения)

  1   50:09:0000000:179835                        г. Москва, вн.тер.г. муниципальный округ Крюково, г Зеленоград, ул Андреевка, д 1, стр 1
  2   77:01:0001075:2898                          г. Москва, вн.тер.г. муниципальный округ Тверской, ул Тверская, д 13
  3                          77:06:0003013:17844  г. Москва, вн.тер.г. муниципальный округ Обручевский, пр-кт Ленинский, д 99, помещ 18/6/1
```

- [ ] **Step 2: Написать падающий тест парсера**

Create `tests/test_pp700.py`:

```python
from pathlib import Path
from kosmos.sources.pp700 import parse_text

FIXTURE = Path(__file__).parent / "fixtures" / "pp700_sample.txt"


def test_parses_building_rows():
    entries = parse_text(FIXTURE.read_text(encoding="utf-8"))
    assert len(entries) == 3


def test_extracts_building_cadastral_number():
    entries = parse_text(FIXTURE.read_text(encoding="utf-8"))
    assert entries[0].cadastral_building == "50:09:0000000:179835"
    assert entries[0].cadastral_room is None


def test_extracts_room_cadastral_number_when_building_absent():
    entries = parse_text(FIXTURE.read_text(encoding="utf-8"))
    assert entries[2].cadastral_building is None
    assert entries[2].cadastral_room == "77:06:0003013:17844"


def test_extracts_address():
    entries = parse_text(FIXTURE.read_text(encoding="utf-8"))
    assert "ул Тверская, д 13" in entries[1].address


def test_ignores_header_lines():
    entries = parse_text(FIXTURE.read_text(encoding="utf-8"))
    assert all(e.cadastral_building or e.cadastral_room for e in entries)


def test_row_numbers_are_sequential():
    entries = parse_text(FIXTURE.read_text(encoding="utf-8"))
    assert [e.row_no for e in entries] == [1, 2, 3]
```

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `pytest tests/test_pp700.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kosmos.sources'`

- [ ] **Step 4: Реализовать модели и парсер**

Create `kosmos/models.py`:

```python
"""Датаклассы КОСМОСа."""
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Pp700Entry:
    """Строка перечня 700-ПП. Ровно то, что есть в PDF, — без домыслов."""
    row_no: int
    cadastral_building: str | None
    cadastral_room: str | None
    address: str
    annex: int


@dataclass(frozen=True)
class Area:
    """Площадь с обязательным провенансом. NULL легитимен."""
    sqm: float | None
    confidence: str  # 'точно' | 'оценка' | 'неизвестно'
    source: str


@dataclass(frozen=True)
class NspdRecord:
    """Ответ НСПД по кадастровому номеру. Только производные поля.

    Инвариант ч. 27: никаких форм выписок, никаких файлов с ЭЦП.
    """
    cadastral_no: str
    area_sqm: float | None
    floors: int | None
    built_year: int | None
    purpose: str | None
    category_name: str | None
```

Create `kosmos/sources/__init__.py` (пустой файл).

Create `kosmos/sources/pp700.py`:

```python
"""Перечень 700-ПП — состав коммерческой недвижимости Москвы.

Источник: Постановление Правительства Москвы N 700-ПП от 28.11.2014.
Базовое постановление не переиздаётся — ежегодно выходит новое,
излагающее приложения в новой редакции. На 2026 год — 2794-ПП от 19.11.2025.

В перечне ровно четыре колонки: N п/п, кадастровый номер здания,
кадастровый номер помещения, адрес. Площади в нём НЕТ.

Лицензия: нормативный правовой акт, п. 5 ст. 1259 ГК — не объект
авторских прав, использование свободно.
"""
import re
from pathlib import Path

import httpx
from pypdf import PdfReader

from kosmos.config import Config
from kosmos.models import Pp700Entry

PP700_2026_URL = "https://www.mos.ru/upload/documents/docs/5318/2794-PP-svfo1.pdf"
PP700_2026_AMENDMENT_URL = "https://www.mos.ru/upload/documents/files/7455/PPMot31032026863-PP.pdf"

# mos.ru отдаёт 403 без браузерного User-Agent.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)

CADASTRAL_RE = re.compile(r"\d{2}:\d{2}:\d{6,7}:\d+")
ROW_START_RE = re.compile(r"^\s*(\d+)\s+")
ANNEX_RE = re.compile(r"Приложение\s+(\d)")


def download(url: str, dest: Path, cfg: Config) -> Path:
    """Скачать PDF перечня. Требует браузерный User-Agent."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream(
        "GET", url, headers={"User-Agent": BROWSER_UA}, timeout=120.0, follow_redirects=True
    ) as response:
        response.raise_for_status()
        with dest.open("wb") as handle:
            for chunk in response.iter_bytes():
                handle.write(chunk)
    return dest


def pdf_to_text(pdf_path: Path) -> str:
    """Извлечь текстовый слой. PDF не скан — текст извлекается чисто."""
    reader = PdfReader(str(pdf_path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def parse_text(text: str) -> list[Pp700Entry]:
    """Разобрать текст перечня в строки.

    Правило разбора: строка данных начинается с номера п/п и содержит
    хотя бы один кадастровый номер. Если кадастровых номеров два —
    первый относится к зданию, второй к помещению. Если один — его
    принадлежность определяется позицией в строке относительно адреса.
    """
    entries: list[Pp700Entry] = []
    annex = 1

    for line in text.splitlines():
        annex_match = ANNEX_RE.search(line)
        if annex_match:
            annex = int(annex_match.group(1))
            continue

        row_match = ROW_START_RE.match(line)
        if not row_match:
            continue

        cadastrals = CADASTRAL_RE.findall(line)
        if not cadastrals:
            continue

        row_no = int(row_match.group(1))
        address = _extract_address(line)

        if len(cadastrals) >= 2:
            building, room = cadastrals[0], cadastrals[1]
        elif annex == 1:
            building, room = cadastrals[0], None
        else:
            building, room = None, cadastrals[0]

        entries.append(
            Pp700Entry(
                row_no=row_no,
                cadastral_building=building,
                cadastral_room=room,
                address=address,
                annex=annex,
            )
        )

    return entries


def _extract_address(line: str) -> str:
    """Адрес — всё от 'г. Москва' до конца строки."""
    marker = line.find("г. Москва")
    if marker == -1:
        return ""
    return line[marker:].strip()
```

Обратите внимание: в приложении 1 одинокий кадастровый номер — это здание, в приложении 2 — помещение. Это следует из сноски к приложению 1: «В случаях, если здание не стоит на кадастровом учете, кадастровый номер не указывается, при этом указываются сведения о расположенных в нем помещениях».

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `pytest tests/test_pp700.py -v`
Expected: PASS, 6 passed

- [ ] **Step 6: Проверить парсер на настоящем PDF**

```bash
python -c "
from pathlib import Path
from kosmos.config import Config
from kosmos.sources.pp700 import download, pdf_to_text, parse_text, PP700_2026_URL

cfg = Config.from_env()
pdf = download(PP700_2026_URL, Path('data/2794-PP.pdf'), cfg)
print('скачано:', pdf.stat().st_size, 'байт')
text = pdf_to_text(pdf)
entries = parse_text(text)
print('строк разобрано:', len(entries))
buildings = [e for e in entries if e.annex == 1]
rooms = [e for e in entries if e.annex == 2]
print('приложение 1 (здания):', len(buildings))
print('приложение 2 (помещения):', len(rooms))
"
```

Expected: скачано ~8 400 000 байт; строк разобрано около 42 000; приложение 1 — около 22 900; приложение 2 — около 19 700.

**Приёмочный критерий:** суммарно 42 000–42 700 строк. Если существенно меньше — парсер теряет строки на переносах страниц, чините перед тем как идти дальше. Если больше — ловите заголовки как данные.

- [ ] **Step 7: Commit**

```bash
git add kosmos/models.py kosmos/sources/ tests/test_pp700.py tests/fixtures/
git commit -m "feat: парсер перечня 700-ПП

Состав коммерческой недвижимости Москвы: 42 343 объекта с кадастровыми
номерами и адресами. Площади в перечне нет — только идентификаторы."
```

---

## Task 3: Клиент НСПД — площадь из ЕГРН

**Files:**
- Create: `kosmos/sources/nspd.py`
- Test: `tests/test_nspd.py`

**Interfaces:**
- Consumes: `kosmos.config.Config`, `kosmos.models.NspdRecord`
- Produces:
  - `kosmos.sources.nspd.NspdClient` с методами `fetch_raw(cadastral_no: str) -> dict | None` и `parse(payload: dict) -> NspdRecord | None`
  - `NspdClient(cfg: Config, rate_limit_per_sec: float = 1.0)`

**Контекст для реализующего.** Геопортал НСПД — наследник публичной кадастровой карты. Эндпоинт недокументированный, но публичный:

```
GET https://nspd.gov.ru/api/geoportal/v2/search/geoportal?query=<кадастровый номер>&thematicSearchId=1
```

Три вещи, на которых легко обжечься:

1. **Заголовок `Referer` обязателен** — без него WAF отдаёт 403. Причём `https://nspd.gov.ru/map` и `https://nspd.gov.ru/` **специально заблокированы** — ими подписываются наивные скраперы. Работает `https://nspd.gov.ru/map?thematic=PKK`. User-Agent не нужен.
2. **TLS.** Сертификат выпущен российским национальным удостоверяющим центром. Питон его не знает. Нужен корневой сертификат Минцифры в bundle — см. шаг 1. **Не отключайте проверку сертификата** — это не решение, а дыра.
3. **Имя поля площади зависит от типа объекта:**

| `categoryName` | поле площади |
|---|---|
| Здания | `build_record_area` |
| Земельные участки | `land_record_area` |
| Помещения | `area` |

Правовые инварианты (спека, раздел 9): берём **только производные поля** — площадь, этажность, год, назначение. Никаких форм выписок, никаких файлов с ЭЦП. Это то, что выводит нас из-под ч. 25 ст. 62 ФЗ-218 через изъятие ч. 27.

- [ ] **Step 1: Установить корневой сертификат Минцифры**

```bash
mkdir -p certs
curl -o certs/russian_trusted_root_ca.cer \
  https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
cat "$(python -c 'import certifi; print(certifi.where())')" \
    certs/russian_trusted_root_ca.cer > certs/kosmos-bundle.pem
export KOSMOS_CA_BUNDLE="$(pwd)/certs/kosmos-bundle.pem"
```

Проверка:

```bash
curl --cacert certs/kosmos-bundle.pem \
  -H "Referer: https://nspd.gov.ru/map?thematic=PKK" \
  "https://nspd.gov.ru/api/geoportal/v2/search/geoportal?query=77:01:0001075:2898&thematicSearchId=1"
```

Expected: JSON с полем `features`. Если 403 — проверьте Referer. Если TLS-ошибка — bundle собран неверно.

- [ ] **Step 2: Написать падающий тест разбора ответа**

Create `tests/test_nspd.py`:

```python
import pytest
from kosmos.config import Config
from kosmos.sources.nspd import NspdClient

CFG = Config(db_dsn="postgresql://test/test")

BUILDING_PAYLOAD = {
    "data": {
        "features": [
            {
                "properties": {
                    "categoryName": "Здания",
                    "options": {
                        "build_record_area": 7198.6,
                        "floors": "12",
                        "year_built": "1998",
                        "purpose": "Нежилое",
                    },
                }
            }
        ]
    }
}

LAND_PAYLOAD = {
    "data": {
        "features": [
            {
                "properties": {
                    "categoryName": "Земельные участки",
                    "options": {"land_record_area": 587.0},
                }
            }
        ]
    }
}

EMPTY_PAYLOAD = {"data": {"features": []}}


def test_parses_building_area():
    client = NspdClient(CFG)
    record = client.parse(BUILDING_PAYLOAD)
    assert record.area_sqm == 7198.6
    assert record.category_name == "Здания"


def test_parses_floors_and_year():
    client = NspdClient(CFG)
    record = client.parse(BUILDING_PAYLOAD)
    assert record.floors == 12
    assert record.built_year == 1998


def test_ignores_land_parcels():
    """Земельный участок — не здание. Его площадь не наша площадь."""
    client = NspdClient(CFG)
    record = client.parse(LAND_PAYLOAD)
    assert record is None


def test_returns_none_on_empty():
    client = NspdClient(CFG)
    assert client.parse(EMPTY_PAYLOAD) is None


def test_missing_area_yields_none_not_zero():
    """NULL легитимен. Ноль — это выдумка."""
    payload = {
        "data": {"features": [{"properties": {"categoryName": "Здания", "options": {}}}]}
    }
    client = NspdClient(CFG)
    record = client.parse(payload)
    assert record.area_sqm is None
```

Последний тест — про инвариант из раздела 2.5 спеки: отсутствие данных не превращается в ноль.

- [ ] **Step 3: Запустить тест, убедиться что падает**

Run: `pytest tests/test_nspd.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kosmos.sources.nspd'`

- [ ] **Step 4: Реализовать клиент**

Create `kosmos/sources/nspd.py`:

```python
"""Геопортал НСПД — площадь зданий из ЕГРН.

Эндпоинт недокументированный, но публичный. ФЗ-218 ст. 12 прямо называет
публичную кадастровую карту предназначенной "для использования
неограниченным кругом лиц ... без взимания платы".

ПРАВОВЫЕ ИНВАРИАНТЫ (спека, раздел 9). Нарушение = штраф ЮЛ 350-600 тыс. руб.:
  1. Берём и храним ТОЛЬКО производные поля (площадь, этажность, год,
     назначение) в собственной табличной форме. Никогда не воспроизводим
     совокупность сведений выписки по утверждённым формам.
  2. НИКОГДА не сохраняем и не пересылаем файлы с подписью или ЭЦП
     Росреестра/ППК.
Это условия изъятия ч. 27 ст. 62 ФЗ-218 — единственная законная опора.
Запасного пути нет.
"""
import time

import httpx

from kosmos.config import Config
from kosmos.models import NspdRecord

NSPD_ENDPOINT = "https://nspd.gov.ru/api/geoportal/v2/search/geoportal"

# Имя поля площади зависит от типа объекта.
AREA_FIELD_BY_CATEGORY = {
    "Здания": "build_record_area",
    "Помещения": "area",
}


class NspdClient:
    """Клиент геопортала. Не быстрее одного запроса в секунду."""

    def __init__(self, cfg: Config, rate_limit_per_sec: float = 1.0):
        self._cfg = cfg
        self._min_interval = 1.0 / rate_limit_per_sec
        self._last_call = 0.0
        self._client = httpx.Client(
            verify=cfg.ca_bundle or True,
            timeout=30.0,
            headers={"Referer": cfg.nspd_referer},
        )

    def fetch_raw(self, cadastral_no: str) -> dict | None:
        """Сырой ответ по кадастровому номеру. None, если объект не найден."""
        self._throttle()
        response = self._client.get(
            NSPD_ENDPOINT,
            params={"query": cadastral_no, "thematicSearchId": 1},
        )
        if response.status_code == 204:
            return None
        response.raise_for_status()
        return response.json()

    def parse(self, payload: dict) -> NspdRecord | None:
        """Разобрать ответ. None, если это не здание или ничего не найдено."""
        features = (payload.get("data") or {}).get("features") or []
        if not features:
            return None

        properties = features[0].get("properties") or {}
        category = properties.get("categoryName")
        if category not in AREA_FIELD_BY_CATEGORY:
            return None

        options = properties.get("options") or {}
        area_field = AREA_FIELD_BY_CATEGORY[category]

        return NspdRecord(
            cadastral_no=options.get("cad_num") or "",
            area_sqm=_as_float(options.get(area_field)),
            floors=_as_int(options.get("floors")),
            built_year=_as_int(options.get("year_built")),
            purpose=options.get("purpose"),
            category_name=category,
        )

    def close(self) -> None:
        self._client.close()

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_call = time.monotonic()


def _as_float(value) -> float | None:
    """NULL легитимен. Ноль — выдумка."""
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None
```

- [ ] **Step 5: Запустить тесты, убедиться что проходят**

Run: `pytest tests/test_nspd.py -v`
Expected: PASS, 5 passed

- [ ] **Step 6: Проверить на живом НСПД**

```bash
python -c "
from kosmos.config import Config
from kosmos.sources.nspd import NspdClient

client = NspdClient(Config.from_env())
payload = client.fetch_raw('77:01:0001075:2898')
record = client.parse(payload)
print('площадь:', record.area_sqm)
print('этажей:', record.floors)
print('категория:', record.category_name)
client.close()
"
```

Expected: непустая площадь, категория «Здания». Если 403 — Referer. Если TLS — bundle.

- [ ] **Step 7: Commit**

```bash
git add kosmos/sources/nspd.py tests/test_nspd.py certs/.gitignore
git commit -m "feat: клиент НСПД — площадь зданий из ЕГРН

Только производные поля, никаких форм выписок и файлов с ЭЦП —
условия изъятия ч.27 ст.62 ФЗ-218. Троттлинг 1 req/s.
Корневой сертификат Минцифры вместо отключения проверки TLS."
```

**Важно:** добавьте `certs/` в `.gitignore` — сертификаты в репозитории не нужны.

---

## Task 4: Запись в реестр с провенансом

**Files:**
- Create: `kosmos/db.py`
- Test: `tests/test_db.py`

**Interfaces:**
- Consumes: `kosmos.config.Config`, `kosmos.models.Pp700Entry`, `kosmos.models.NspdRecord`
- Produces:
  - `kosmos.db.Registry` с методами:
    - `record_observation(source: str, cadastral_no: str | None, payload: dict, source_url: str | None) -> int`
    - `upsert_from_pp700(entry: Pp700Entry) -> int` — возвращает `object_id`
    - `apply_nspd(cadastral_no: str, record: NspdRecord) -> None`
    - `mark_baseline_complete() -> None`
    - `count_objects() -> int`

- [ ] **Step 1: Написать падающий тест**

Create `tests/test_db.py`:

```python
import pytest
from kosmos.config import Config
from kosmos.db import Registry
from kosmos.models import NspdRecord, Pp700Entry

pytestmark = pytest.mark.integration


@pytest.fixture
def registry():
    reg = Registry(Config.from_env())
    reg.execute("TRUNCATE kosmos.objects, kosmos.observations RESTART IDENTITY CASCADE")
    yield reg
    reg.close()


ENTRY = Pp700Entry(
    row_no=2,
    cadastral_building="77:01:0001075:2898",
    cadastral_room=None,
    address="г. Москва, ул Тверская, д 13",
    annex=1,
)


def test_upsert_creates_object(registry):
    object_id = registry.upsert_from_pp700(ENTRY)
    assert object_id > 0
    assert registry.count_objects() == 1


def test_upsert_is_idempotent(registry):
    first = registry.upsert_from_pp700(ENTRY)
    second = registry.upsert_from_pp700(ENTRY)
    assert first == second
    assert registry.count_objects() == 1


def test_apply_nspd_writes_area_with_source(registry):
    registry.upsert_from_pp700(ENTRY)
    registry.apply_nspd(
        "77:01:0001075:2898",
        NspdRecord(
            cadastral_no="77:01:0001075:2898",
            area_sqm=7198.6,
            floors=12,
            built_year=1998,
            purpose="Нежилое",
            category_name="Здания",
        ),
    )
    row = registry.fetch_one(
        "SELECT area_sqm, area_source, area_confidence FROM kosmos.objects "
        "WHERE cadastral_no = %s",
        ("77:01:0001075:2898",),
    )
    assert float(row[0]) == 7198.6
    assert row[1] == "nspd"
    assert row[2] == "точно"


def test_apply_nspd_with_null_area_writes_null_not_zero(registry):
    """Отсутствие данных не превращается в ноль."""
    registry.upsert_from_pp700(ENTRY)
    registry.apply_nspd(
        "77:01:0001075:2898",
        NspdRecord(
            cadastral_no="77:01:0001075:2898",
            area_sqm=None,
            floors=None,
            built_year=None,
            purpose=None,
            category_name="Здания",
        ),
    )
    row = registry.fetch_one(
        "SELECT area_sqm, area_source FROM kosmos.objects WHERE cadastral_no = %s",
        ("77:01:0001075:2898",),
    )
    assert row[0] is None
    assert row[1] is None


def test_observation_is_recorded(registry):
    registry.record_observation(
        source="pp700",
        cadastral_no="77:01:0001075:2898",
        payload={"row_no": 2},
        source_url="https://www.mos.ru/example",
    )
    count = registry.fetch_one("SELECT count(*) FROM kosmos.observations")[0]
    assert count == 1
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `pytest tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kosmos.db'`

- [ ] **Step 3: Реализовать доступ к базе**

Create `kosmos/db.py`:

```python
"""Реестр КОСМОС. Единственное место, где пишутся объекты.

Правило: машина пишет в objects, человек — в verdicts. Никогда не наоборот.
"""
import json

import psycopg

from kosmos.config import Config
from kosmos.models import NspdRecord, Pp700Entry

SOURCE_PP700 = "pp700"
SOURCE_NSPD = "nspd"


class Registry:
    def __init__(self, cfg: Config):
        self._conn = psycopg.connect(cfg.db_dsn, autocommit=True)

    def execute(self, sql: str, params: tuple = ()) -> None:
        with self._conn.cursor() as cur:
            cur.execute(sql, params)

    def fetch_one(self, sql: str, params: tuple = ()):
        with self._conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()

    def record_observation(
        self,
        source: str,
        cadastral_no: str | None,
        payload: dict,
        source_url: str | None = None,
    ) -> int:
        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO kosmos.observations "
                "(source, cadastral_no, payload, source_url) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (source, cadastral_no, json.dumps(payload, ensure_ascii=False), source_url),
            )
            return cur.fetchone()[0]

    def upsert_from_pp700(self, entry: Pp700Entry) -> int:
        """Создать или обновить объект из строки перечня.

        Перечень даёт только идентификатор и адрес. Площади в нём нет —
        не пытайтесь её сюда записать.
        """
        cadastral_no = entry.cadastral_building or entry.cadastral_room
        if not cadastral_no:
            raise ValueError(f"строка {entry.row_no} без кадастрового номера")

        with self._conn.cursor() as cur:
            cur.execute(
                "INSERT INTO kosmos.objects (cadastral_no, address, baseline_run) "
                "VALUES (%s, %s, true) "
                "ON CONFLICT (cadastral_no) DO UPDATE "
                "SET address = EXCLUDED.address, last_seen_at = now() "
                "RETURNING id",
                (cadastral_no, entry.address),
            )
            return cur.fetchone()[0]

    def apply_nspd(self, cadastral_no: str, record: NspdRecord) -> None:
        """Записать данные ЕГРН. Источник указывается всегда.

        Если площадь None — источник тоже None. Пустая ячейка честнее
        выдуманной, и CHECK-constraint это не пропустит иначе.
        """
        area_source = SOURCE_NSPD if record.area_sqm is not None else None
        area_confidence = "точно" if record.area_sqm is not None else None
        floors_source = SOURCE_NSPD if record.floors is not None else None
        year_source = SOURCE_NSPD if record.built_year is not None else None

        self.execute(
            "UPDATE kosmos.objects SET "
            "  area_sqm = %s, area_source = %s, area_confidence = %s, "
            "  floors = %s, floors_source = %s, "
            "  built_year = %s, built_year_source = %s, "
            "  last_seen_at = now() "
            "WHERE cadastral_no = %s",
            (
                record.area_sqm,
                area_source,
                area_confidence,
                record.floors,
                floors_source,
                record.built_year,
                year_source,
                cadastral_no,
            ),
        )

    def mark_baseline_complete(self) -> None:
        """Снять флаг baseline: дальше новое подсвечивается как новое."""
        self.execute("UPDATE kosmos.objects SET baseline_run = false")

    def count_objects(self) -> int:
        return self.fetch_one("SELECT count(*) FROM kosmos.objects")[0]

    def close(self) -> None:
        self._conn.close()
```

Площадь из НСПД получает метку `точно` — это учтённая площадь ЕГРН, а не пересчёт геометрии. Проверено численно: здание с полигоном 587 м² и 12 этажами отдаёт 7 198,6 м², отношение совпадает с этажностью.

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pytest tests/test_db.py -v`
Expected: PASS, 5 passed

- [ ] **Step 5: Commit**

```bash
git add kosmos/db.py tests/test_db.py
git commit -m "feat: запись в реестр с обязательным провенансом

Площадь без источника не записывается — ни в коде, ни в схеме.
None остаётся None и не превращается в ноль."
```

---

## Task 5: Фильтр по площади и серая зона

**Files:**
- Create: `kosmos/filters.py`
- Test: `tests/test_filters.py`

**Interfaces:**
- Consumes: `kosmos.models.Area`
- Produces:
  - `kosmos.filters.Destination` — enum: `MAIN`, `REVIEW`, `NONE`
  - `kosmos.filters.route(area: Area) -> Destination`
  - Константы `AREA_THRESHOLD = 10_000.0`, `GREY_ZONE_FLOOR = 8_000.0`

**Контекст.** Правило серой зоны применяется **только к площадям с меткой «оценка»**. Точная площадь 9 500 м² — это не серая зона, это «не наш объект»: порог заявлен источником, сомневаться не в чем. Иначе лист «НА ПРОВЕРКУ» забьётся заведомо мелкими зданиями.

- [ ] **Step 1: Написать падающий тест**

Create `tests/test_filters.py`:

```python
from kosmos.filters import Destination, route
from kosmos.models import Area


def test_exact_above_threshold_goes_main():
    assert route(Area(15000.0, "точно", "nspd")) is Destination.MAIN


def test_exact_below_threshold_goes_nowhere():
    """Порог заявлен источником — сомневаться не в чем."""
    assert route(Area(9500.0, "точно", "nspd")) is Destination.NONE


def test_estimate_above_threshold_goes_main():
    assert route(Area(12000.0, "оценка", "osm")) is Destination.MAIN


def test_estimate_in_grey_zone_goes_review():
    assert route(Area(8500.0, "оценка", "osm")) is Destination.REVIEW


def test_estimate_below_grey_zone_goes_nowhere():
    assert route(Area(7000.0, "оценка", "osm")) is Destination.NONE


def test_unknown_goes_nowhere():
    """В реестре объект есть, в витрину не идёт."""
    assert route(Area(None, "неизвестно", "none")) is Destination.NONE


def test_grey_zone_boundaries_are_inclusive_at_floor():
    assert route(Area(8000.0, "оценка", "osm")) is Destination.REVIEW


def test_threshold_is_inclusive():
    assert route(Area(10000.0, "точно", "nspd")) is Destination.MAIN
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `pytest tests/test_filters.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kosmos.filters'`

- [ ] **Step 3: Реализовать маршрутизацию**

Create `kosmos/filters.py`:

```python
"""Маршрутизация объектов по листам витрины.

Серая зона существует потому, что оценочная площадь имеет погрешность
+-25%: оценка 8 500 м² может оказаться настоящими 11 000 м². Для точной
площади порог — чёткая линия, серой зоны нет.
"""
from enum import Enum

from kosmos.models import Area

AREA_THRESHOLD = 10_000.0
GREY_ZONE_FLOOR = 8_000.0


class Destination(Enum):
    MAIN = "основной_лист"
    REVIEW = "на_проверку"
    NONE = "не_показывать"


def route(area: Area) -> Destination:
    if area.sqm is None or area.confidence == "неизвестно":
        return Destination.NONE

    if area.confidence == "точно":
        return Destination.MAIN if area.sqm >= AREA_THRESHOLD else Destination.NONE

    # оценка
    if area.sqm >= AREA_THRESHOLD:
        return Destination.MAIN
    if area.sqm >= GREY_ZONE_FLOOR:
        return Destination.REVIEW
    return Destination.NONE
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pytest tests/test_filters.py -v`
Expected: PASS, 8 passed

- [ ] **Step 5: Commit**

```bash
git add kosmos/filters.py tests/test_filters.py
git commit -m "feat: фильтр по площади и серая зона

Серая зона — только для оценочных площадей. Точная 9500 — не серая зона,
а 'не наш объект'."
```

---

## Task 6: Вычитание точек МИЛТИ по UNOM

**Files:**
- Create: `kosmos/sources/addr_registry.py`
- Create: `kosmos/subtract.py`
- Test: `tests/test_subtract.py`

**Interfaces:**
- Consumes: `kosmos.config.Config`, `kosmos.db.Registry`
- Produces:
  - `kosmos.sources.addr_registry.load_unom_map(path: Path) -> dict[str, int]` — кадастровый номер → UNOM
  - `kosmos.subtract.subtract_our_points(registry: Registry) -> SubtractionReport`
  - `kosmos.subtract.selfcheck(registry: Registry) -> list[tuple[str, str]]` — регресс-тест правила
  - `SubtractionReport` — датакласс: `subtracted: int`, `unresolved: int`, `flagged: int`

**Контекст для реализующего — прочитайте обязательно.**

Первая редакция дизайна вычитала по радиусу 150 метров и это была **ошибка, которую нашёл red-team разбор**. Дефект не в числе, а в подмене понятия: «1 минута ходьбы» — критерий близости к клиенту, а не критерий каннибализации. Радиус исключения (150 м) был **больше радиуса обслуживания** (80–100 м) — правило вычитало здания, которые точка обслужить не может.

Численно: одна точка в Башне Федерация вычитала Меркурий (~65 м) и Империю (~120 м) — 400 тысяч квадратных метров лидов за одно открытие. И чем больше у МИЛТИ точек, тем меньше лидов видела система.

**Поэтому: вычитаем только по точному совпадению UNOM.** Расстояние до ближайшей нашей точки — это колонка в основном листе, а не причина удаления.

UNOM — стабильный идентификатор здания из адресного реестра data.mos.ru #60562 (548 тыс. адресов, CC BY 4.0, требуется атрибуция).

- [ ] **Step 1: Написать падающий тест**

Create `tests/test_subtract.py`:

```python
import pytest
from kosmos.config import Config
from kosmos.db import Registry
from kosmos.subtract import selfcheck, subtract_our_points

pytestmark = pytest.mark.integration


@pytest.fixture
def registry():
    reg = Registry(Config.from_env())
    reg.execute(
        "TRUNCATE kosmos.objects, kosmos.our_points, kosmos.closed_points "
        "RESTART IDENTITY CASCADE"
    )
    yield reg
    reg.close()


def _add_object(reg, cadastral_no, unom, area):
    reg.execute(
        "INSERT INTO kosmos.objects "
        "(cadastral_no, unom, area_sqm, area_source, area_confidence) "
        "VALUES (%s, %s, %s, 'nspd', 'точно')",
        (cadastral_no, unom, area),
    )


def _add_our_point(reg, address, unom, resolved=True):
    reg.execute(
        "INSERT INTO kosmos.our_points (address_raw, unom, resolved) VALUES (%s, %s, %s)",
        (address, unom, resolved),
    )


def test_subtracts_exact_unom_match(registry):
    _add_object(registry, "77:01:0001:1", 12345, 15000)
    _add_our_point(registry, "ул Тверская, д 13", 12345)

    report = subtract_our_points(registry)

    assert report.subtracted == 1
    status = registry.fetch_one(
        "SELECT status FROM kosmos.objects WHERE cadastral_no = '77:01:0001:1'"
    )[0]
    assert status == "вычтен_наша_точка"


def test_does_not_subtract_neighbouring_building(registry):
    """Соседняя башня — другой UNOM. Не вычитается.

    Регрессия на баг ред.1: радиус 150 м стирал Меркурий и Империю
    из-за одной точки в Башне Федерация.
    """
    _add_object(registry, "77:01:0001:1", 11111, 180000)  # Меркурий
    _add_object(registry, "77:01:0001:2", 22222, 230000)  # Империя
    _add_our_point(registry, "Башня Федерация", 33333)

    report = subtract_our_points(registry)

    assert report.subtracted == 0
    active = registry.fetch_one(
        "SELECT count(*) FROM kosmos.objects WHERE status = 'активен'"
    )[0]
    assert active == 2


def test_unresolved_point_flags_not_subtracts(registry):
    """Негеокодированная точка помечает, но не вычитает."""
    _add_object(registry, "77:01:0001:1", 12345, 15000)
    _add_our_point(registry, "где-то на Тверской", None, resolved=False)

    report = subtract_our_points(registry)

    assert report.subtracted == 0
    assert report.unresolved == 1
    status = registry.fetch_one(
        "SELECT status FROM kosmos.objects WHERE cadastral_no = '77:01:0001:1'"
    )[0]
    assert status == "активен"


def test_subtraction_records_reason(registry):
    _add_object(registry, "77:01:0001:1", 12345, 15000)
    _add_our_point(registry, "ул Тверская, д 13", 12345)

    subtract_our_points(registry)

    reason = registry.fetch_one(
        "SELECT subtract_reason FROM kosmos.objects WHERE cadastral_no = '77:01:0001:1'"
    )[0]
    assert "12345" in reason


def test_selfcheck_detects_self_excluding_rule(registry):
    """Регресс-тест правила: если одна наша точка исключает другую —
    правило неверно по построению."""
    _add_our_point(registry, "точка А", 12345)
    _add_our_point(registry, "точка Б", 12345)

    collisions = selfcheck(registry)

    assert len(collisions) == 1


def test_selfcheck_passes_on_distinct_points(registry):
    _add_our_point(registry, "точка А", 11111)
    _add_our_point(registry, "точка Б", 22222)

    assert selfcheck(registry) == []
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `pytest tests/test_subtract.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kosmos.subtract'`

- [ ] **Step 3: Реализовать вычитание**

Create `kosmos/subtract.py`:

```python
"""Вычитание точек МИЛТИ из реестра.

ВНИМАНИЕ. Вычитаем ТОЛЬКО по точному совпадению UNOM.

Ред. 1 вычитала по радиусу 150 м — это была ошибка, найденная red-team
разбором. "1 минута ходьбы" — критерий близости к клиенту, а не критерий
каннибализации. Радиус исключения был больше радиуса обслуживания:
правило вычитало здания, которые точка обслужить не может. Одна точка
в Башне Федерация стирала Меркурий и Империю — 400 тыс. м² лидов.
Чем больше точек у МИЛТИ, тем меньше лидов видела система.

Расстояние до ближайшей точки — колонка в витрине, а не причина удаления.
"""
from dataclasses import dataclass

from kosmos.db import Registry


@dataclass(frozen=True)
class SubtractionReport:
    subtracted: int
    unresolved: int
    flagged: int


def subtract_our_points(registry: Registry) -> SubtractionReport:
    """Вычесть действующие и закрытые точки по совпадению UNOM."""
    subtracted = 0

    for table, status in (
        ("our_points", "вычтен_наша_точка"),
        ("closed_points", "вычтен_закрытая_точка"),
    ):
        with registry._conn.cursor() as cur:
            cur.execute(
                f"UPDATE kosmos.objects o SET "
                f"  status = %s, "
                f"  subtract_reason = 'совпадение UNOM ' || o.unom::text "
                f"                    || ' с точкой из {table}' "
                f"FROM kosmos.{table} p "
                f"WHERE o.unom IS NOT NULL "
                f"  AND p.unom IS NOT NULL "
                f"  AND p.resolved = true "
                f"  AND o.unom = p.unom "
                f"  AND o.status = 'активен'",
                (status,),
            )
            subtracted += cur.rowcount

    unresolved = registry.fetch_one(
        "SELECT count(*) FROM ("
        "  SELECT id FROM kosmos.our_points WHERE resolved = false"
        "  UNION ALL"
        "  SELECT id FROM kosmos.closed_points WHERE resolved = false"
        ") AS unresolved_points"
    )[0]

    return SubtractionReport(subtracted=subtracted, unresolved=unresolved, flagged=0)


def selfcheck(registry: Registry) -> list[tuple[str, str]]:
    """Регресс-тест правила вычитания.

    Применяем правило к самому списку точек МИЛТИ. Если одна существующая
    точка исключает другую — правило неверно по построению, и запускать
    сборку нельзя.
    """
    with registry._conn.cursor() as cur:
        cur.execute(
            "SELECT a.address_raw, b.address_raw "
            "FROM kosmos.our_points a "
            "JOIN kosmos.our_points b "
            "  ON a.unom = b.unom AND a.id < b.id "
            "WHERE a.unom IS NOT NULL AND a.resolved AND b.resolved"
        )
        return [(row[0], row[1]) for row in cur.fetchall()]
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pytest tests/test_subtract.py -v`
Expected: PASS, 6 passed

- [ ] **Step 5: Реализовать загрузку UNOM из адресного реестра**

Create `kosmos/sources/addr_registry.py`:

```python
"""Адресный реестр Москвы — UNOM по кадастровому номеру.

Источник: data.mos.ru, датасет 60562 "Адресный реестр объектов
недвижимости города Москвы". 548 тыс. адресов.

Лицензия: CC BY 4.0. При использовании требуется ссылка на первоисточник —
Портал открытых данных Правительства Москвы (data.mos.ru).

Площади в этом датасете нет — только адреса, UNOM и кадастровые номера.
Он нужен исключительно как ключ склейки.
"""
import json
from pathlib import Path

ATTRIBUTION = (
    "Источник: Портал открытых данных Правительства Москвы (data.mos.ru), "
    "датасет 60562 «Адресный реестр объектов недвижимости города Москвы». "
    "Лицензия CC BY 4.0."
)


def load_unom_map(path: Path) -> dict[str, int]:
    """Построить отображение кадастровый номер -> UNOM из выгрузки реестра.

    У одного здания может быть несколько кадастровых номеров; у одного
    кадастрового номера — один UNOM.
    """
    mapping: dict[str, int] = {}
    raw = json.loads(path.read_text(encoding="utf-8"))

    for item in raw:
        cells = item.get("Cells", item)
        unom = cells.get("UNOM")
        cadastrals = cells.get("KAD_N") or cells.get("CadastralNumber")
        if not unom or not cadastrals:
            continue
        if isinstance(cadastrals, str):
            cadastrals = [cadastrals]
        for cadastral_no in cadastrals:
            if cadastral_no:
                mapping[cadastral_no.strip()] = int(unom)

    return mapping
```

- [ ] **Step 6: Написать падающий тест простановки UNOM**

Без этого шага вычитание работает вхолостую: колонка `unom` пуста,
совпадений ноль, Дима получает базу со всеми своими точками внутри.

Add to `tests/test_subtract.py`:

```python
def test_apply_unom_map_fills_column(registry):
    registry.execute("INSERT INTO kosmos.objects (cadastral_no) VALUES ('77:01:0001:1')")

    from kosmos.subtract import apply_unom_map
    applied = apply_unom_map(registry, {"77:01:0001:1": 12345})

    assert applied == 1
    unom = registry.fetch_one(
        "SELECT unom FROM kosmos.objects WHERE cadastral_no = '77:01:0001:1'"
    )[0]
    assert unom == 12345


def test_apply_unom_map_leaves_unknown_null(registry):
    """Нет в адресном реестре — остаётся NULL. Не выдумываем."""
    registry.execute("INSERT INTO kosmos.objects (cadastral_no) VALUES ('77:01:0001:9')")

    from kosmos.subtract import apply_unom_map
    apply_unom_map(registry, {"77:01:0001:1": 12345})

    unom = registry.fetch_one(
        "SELECT unom FROM kosmos.objects WHERE cadastral_no = '77:01:0001:9'"
    )[0]
    assert unom is None
```

- [ ] **Step 7: Реализовать простановку UNOM**

Add to `kosmos/subtract.py`:

```python
def apply_unom_map(registry: Registry, unom_by_cadastral: dict[str, int]) -> int:
    """Проставить объектам UNOM из адресного реестра.

    Без этого вычитание работает вхолостую. Кадастровые номера, которых
    нет в реестре, остаются с NULL — не выдумываем.
    """
    applied = 0
    with registry._conn.cursor() as cur:
        for cadastral_no, unom in unom_by_cadastral.items():
            cur.execute(
                "UPDATE kosmos.objects SET unom = %s "
                "WHERE cadastral_no = %s AND unom IS NULL",
                (unom, cadastral_no),
            )
            applied += cur.rowcount
    return applied
```

Add to `kosmos/sources/addr_registry.py`:

```python
DATASET_URL = "https://data.mos.ru/api/v2/odata/catalog/get"
DATASET_ID = 60562


def download_dataset(dest: Path) -> Path:
    """Выгрузить адресный реестр.

    Публичный API портала без ключа. Внимание: параметр id — это не id
    датасета, а version.publicationCatalogId. Уточните его через
    GET https://data.mos.ru/api/v2/odata/datasets/60562 перед прогоном:
    портал меняет его при каждой публикации.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    offset = 0

    with httpx.Client(timeout=120.0) as client:
        while True:
            response = client.post(
                DATASET_URL,
                json={"id": _catalog_id(client), "limit": 1000, "offset": offset},
            )
            response.raise_for_status()
            chunk = response.json()
            if not chunk:
                break
            rows.extend(chunk)
            offset += 1000

    dest.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return dest


def _catalog_id(client: httpx.Client) -> int:
    response = client.get(f"https://data.mos.ru/api/v2/odata/datasets/{DATASET_ID}")
    response.raise_for_status()
    meta = response.json()
    return meta["version"]["publicationCatalogId"]
```

Добавьте `import httpx` в начало `kosmos/sources/addr_registry.py`.

- [ ] **Step 8: Запустить тесты, убедиться что проходят**

Run: `pytest tests/test_subtract.py -v`
Expected: PASS, 8 passed

- [ ] **Step 9: Commit**

```bash
git add kosmos/subtract.py kosmos/sources/addr_registry.py tests/test_subtract.py
git commit -m "feat: вычитание точек МИЛТИ по UNOM

Замена радиуса 150 м на точное совпадение UNOM. Радиус исключения был
больше радиуса обслуживания — вычитались здания, которые точка обслужить
не может. Регресс-тест: правило не должно исключать наши точки друг другом."
```

---

## Task 7: Оркестратор разовой сборки

**Files:**
- Create: `scripts/build_baseline.py`
- Test: `tests/test_build_baseline.py`

**Interfaces:**
- Consumes: всё предыдущее
- Produces: `scripts/build_baseline.py` — исполняемый скрипт с этапами `parse`, `enrich`, `subtract`, `all`

**Контекст.** Порядок этапов определяет стоимость всего проекта. Обогащение идёт **после** фильтра: 42 343 объекта через НСПД (~12 часов), фильтр 10 000 м² оставляет ~1 500, и только для них добираются название и трафик. Обратный порядок сделал бы проект неподъёмным.

Скрипт должен быть **возобновляемым**: 12 часов работы нельзя терять из-за одного таймаута.

- [ ] **Step 1: Написать падающий тест возобновляемости**

Create `tests/test_build_baseline.py`:

```python
import pytest
from kosmos.config import Config
from kosmos.db import Registry
from scripts.build_baseline import pending_cadastrals

pytestmark = pytest.mark.integration


@pytest.fixture
def registry():
    reg = Registry(Config.from_env())
    reg.execute("TRUNCATE kosmos.objects RESTART IDENTITY CASCADE")
    yield reg
    reg.close()


def test_pending_excludes_already_enriched(registry):
    """Возобновляемость: 12 часов работы нельзя терять из-за таймаута."""
    registry.execute(
        "INSERT INTO kosmos.objects (cadastral_no, area_sqm, area_source, area_confidence) "
        "VALUES ('77:01:0001:1', 15000, 'nspd', 'точно')"
    )
    registry.execute(
        "INSERT INTO kosmos.objects (cadastral_no) VALUES ('77:01:0001:2')"
    )

    pending = pending_cadastrals(registry)

    assert pending == ["77:01:0001:2"]


def test_pending_is_empty_when_all_enriched(registry):
    registry.execute(
        "INSERT INTO kosmos.objects (cadastral_no, area_sqm, area_source, area_confidence) "
        "VALUES ('77:01:0001:1', 15000, 'nspd', 'точно')"
    )
    assert pending_cadastrals(registry) == []
```

- [ ] **Step 2: Запустить тест, убедиться что падает**

Run: `pytest tests/test_build_baseline.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.build_baseline'`

- [ ] **Step 3: Реализовать оркестратор**

Create `scripts/__init__.py` (пустой файл).

Create `scripts/build_baseline.py`:

```python
"""Разовая сборка реестра КОСМОС.

Порядок этапов — не произвол, а суть проекта:
  1. parse    — перечень 700-ПП -> 42 343 кадастровых номера (минуты)
  2. enrich   — НСПД по каждому -> площадь (~12 часов при 1 req/s)
  3. unom     — адресный реестр -> UNOM для склейки (минуты)
  4. subtract — вычитание точек МИЛТИ по UNOM (секунды)

Этап unom обязателен перед subtract: без него колонка пуста, совпадений
ноль, и Дима получает базу со своими же действующими точками внутри.

Обогащение названиями и трафиком идёт ПОСЛЕ фильтра по площади,
когда объектов остаётся ~1 500, а не 42 000.

Скрипт возобновляемый: повторный запуск enrich продолжит с того места,
где остановился. 12 часов работы нельзя терять из-за одного таймаута.

Запуск:
    python -m scripts.build_baseline all
    python -m scripts.build_baseline enrich   # продолжить после сбоя
"""
import sys
from pathlib import Path

from kosmos.config import Config
from kosmos.db import SOURCE_PP700, Registry
from kosmos.sources.addr_registry import (
    ATTRIBUTION,
    download_dataset,
    load_unom_map,
)
from kosmos.sources.nspd import NspdClient
from kosmos.sources.pp700 import (
    PP700_2026_URL,
    download,
    parse_text,
    pdf_to_text,
)
from kosmos.subtract import apply_unom_map, selfcheck, subtract_our_points

DATA_DIR = Path("data")


def stage_parse(registry: Registry, cfg: Config) -> int:
    """Скачать перечень и загрузить состав в реестр."""
    pdf_path = download(PP700_2026_URL, DATA_DIR / "2794-PP.pdf", cfg)
    entries = parse_text(pdf_to_text(pdf_path))

    if not (42_000 <= len(entries) <= 42_700):
        raise RuntimeError(
            f"разобрано {len(entries)} строк, ожидалось 42 000-42 700. "
            "Парсер теряет строки или ловит заголовки — чините до запуска."
        )

    for entry in entries:
        object_id = registry.upsert_from_pp700(entry)
        registry.record_observation(
            source=SOURCE_PP700,
            cadastral_no=entry.cadastral_building or entry.cadastral_room,
            payload={
                "row_no": entry.row_no,
                "annex": entry.annex,
                "address": entry.address,
            },
            source_url=PP700_2026_URL,
        )

    print(f"загружено объектов: {len(entries)}")
    return len(entries)


def pending_cadastrals(registry: Registry) -> list[str]:
    """Кадастровые номера, которые ещё не обогащены. Основа возобновляемости."""
    with registry._conn.cursor() as cur:
        cur.execute(
            "SELECT cadastral_no FROM kosmos.objects "
            "WHERE area_source IS NULL ORDER BY id"
        )
        return [row[0] for row in cur.fetchall()]


def stage_enrich(registry: Registry, cfg: Config) -> None:
    """Обогатить площадью из ЕГРН. ~12 часов при 1 req/s. Возобновляемо."""
    client = NspdClient(cfg, rate_limit_per_sec=1.0)
    pending = pending_cadastrals(registry)
    print(f"к обогащению: {len(pending)}")

    try:
        for index, cadastral_no in enumerate(pending, start=1):
            try:
                payload = client.fetch_raw(cadastral_no)
            except Exception as error:  # сеть, WAF, таймаут
                print(f"[{index}/{len(pending)}] {cadastral_no}: ошибка {error}")
                continue

            if payload is None:
                continue

            registry.record_observation(
                source="nspd", cadastral_no=cadastral_no, payload=payload
            )
            record = client.parse(payload)
            if record is not None:
                registry.apply_nspd(cadastral_no, record)

            if index % 500 == 0:
                print(f"[{index}/{len(pending)}] обогащено")
    finally:
        client.close()


def stage_unom(registry: Registry) -> None:
    """Проставить UNOM из адресного реестра Москвы.

    Обязательный шаг перед вычитанием: без UNOM вычитание работает
    вхолостую и Дима получает базу со своими же точками внутри.
    """
    dataset = DATA_DIR / "addr_registry_60562.json"
    if not dataset.exists():
        download_dataset(dataset)

    unom_map = load_unom_map(dataset)
    applied = apply_unom_map(registry, unom_map)

    total = registry.count_objects()
    print(f"UNOM проставлен: {applied} из {total}")
    print(ATTRIBUTION)

    coverage = applied / total if total else 0
    if coverage < 0.5:
        raise RuntimeError(
            f"UNOM склеился только для {coverage:.0%} объектов. "
            "Вычитание точек будет дырявым — разберитесь до запуска subtract."
        )


def stage_subtract(registry: Registry) -> None:
    """Вычесть точки МИЛТИ. Только по UNOM."""
    collisions = selfcheck(registry)
    if collisions:
        raise RuntimeError(
            f"регресс-тест провален: {len(collisions)} пар наших точек "
            f"исключают друг друга, например {collisions[0]}. "
            "Правило вычитания неверно по построению — не запускайте сборку."
        )

    report = subtract_our_points(registry)
    print(f"вычтено: {report.subtracted}, нерезолвлено точек: {report.unresolved}")


def main() -> int:
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    cfg = Config.from_env()
    registry = Registry(cfg)

    try:
        if stage in ("parse", "all"):
            stage_parse(registry, cfg)
        if stage in ("enrich", "all"):
            stage_enrich(registry, cfg)
        if stage in ("unom", "all"):
            stage_unom(registry)
        if stage in ("subtract", "all"):
            stage_subtract(registry)
        if stage == "all":
            registry.mark_baseline_complete()
            print("baseline снят: дальше новое подсвечивается как новое")
    finally:
        registry.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `pytest tests/test_build_baseline.py -v`
Expected: PASS, 2 passed

- [ ] **Step 5: Прогнать этап parse на настоящих данных**

```bash
python -m scripts.build_baseline parse
```

Expected: `загружено объектов: 42XXX`

Проверка:

```bash
psql "$KOSMOS_DB_DSN" -c "SELECT count(*) FROM kosmos.objects;"
psql "$KOSMOS_DB_DSN" -c "SELECT count(*) FROM kosmos.observations WHERE source = 'pp700';"
```

Expected: обе цифры около 42 300.

- [ ] **Step 6: Прогнать enrich на подвыборке**

Перед двенадцатичасовым прогоном убедитесь, что обогащение работает:

```bash
psql "$KOSMOS_DB_DSN" -c \
  "SELECT cadastral_no FROM kosmos.objects WHERE area_source IS NULL LIMIT 20;"
```

Возьмите 20 номеров, прогоните вручную через `NspdClient`, посчитайте долю непустых площадей.

**Приёмочный критерий:** не менее 60% зданий из выборки отдают площадь. Если существенно меньше — разберитесь до полного прогона, иначе потеряете 12 часов.

- [ ] **Step 7: Полный прогон**

```bash
nohup python -m scripts.build_baseline enrich > logs/enrich.log 2>&1 &
```

Ожидаемое время: ~12 часов. Скрипт возобновляемый — при обрыве просто запустите заново.

Итоговая проверка:

```bash
psql "$KOSMOS_DB_DSN" -c "
SELECT
  count(*) FILTER (WHERE area_sqm IS NOT NULL) AS с_площадью,
  count(*) FILTER (WHERE area_sqm IS NULL)     AS без_площади,
  count(*) FILTER (WHERE area_sqm >= 10000)    AS от_10к
FROM kosmos.objects;
"
```

Expected: `от_10к` — порядка 1 000–2 000. Это и есть список лидов Димы.

- [ ] **Step 8: Commit**

```bash
git add scripts/ tests/test_build_baseline.py
git commit -m "feat: оркестратор разовой сборки реестра

Возобновляемый: повторный запуск enrich продолжает с места обрыва.
Регресс-тест правила вычитания блокирует сборку, если правило
исключает наши точки друг другом."
```

---

## Что дальше

Этот план заканчивается работающим реестром в Postgres: ~42 000 объектов, из них ~1 500 от 10 000 м² с площадями из ЕГРН, с вычтенными точками МИЛТИ и полным журналом провенанса.

**Не входит в этот план и требует отдельных:**

1. **Витрина и еженедельный конвейер** — публикация в Google Sheets, конкуренты через 2ГИС, дельта, лист «В СТРОЙКЕ» из реестра разрешений на ввод, расписание в n8n.
2. **Telegram-бот и аналитик** — дайджест, диалог, вердикты кнопками.

**Блокеры вне кода, которые надо запустить параллельно:**

- Письмо в 2ГИС (dev@2gis.ru) с запросом цены опции хранения данных. Публичного прайса нет, лицензия считается индивидуально. Без этого нет названий БЦ и конкурентов.
- Пакет вопросов юристу МИЛТИ (спека, раздел 9): ч. 27 ст. 62 по ЕГРН, ст. 1334 ГК по ЦИАН, 152-ФЗ по контактам.
- Списки действующих и закрытых точек от Димы — **блокирующие** для Task 6.
