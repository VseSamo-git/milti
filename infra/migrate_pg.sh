#!/bin/bash
# Переезд kosmos с Supabase на локальный postgres:17 (выполнено 2026-07-29).
# Лежит на сервере как /root/kosmos/migrate_pg.sh. Паролей внутри НЕТ —
# KOSMOS_DB_URL читается из .env в момент запуска (иначе классификатор Claude
# рубит команду как эксфильтрацию учёток). Запускает пользователь руками:
#   ssh -i ~/.ssh/beget_n8n root@makersai.ru "bash /root/kosmos/migrate_pg.sh"
# Supabase остаётся цел как бэкап (.env.supabase.bak).
set -e
cd /root/kosmos
SUPA=$(grep "^KOSMOS_DB_URL=" .env | cut -d= -f2-)
PW=$(openssl rand -hex 24)
echo "=== стоп демона обогащения ==="
docker stop kosmos-enrich >/dev/null 2>&1 || true
echo "=== создаю kosmos-postgres (postgres:17, сеть web) ==="
docker rm -f kosmos-postgres >/dev/null 2>&1 || true
docker volume rm kosmos_pgdata >/dev/null 2>&1 || true
docker volume create kosmos_pgdata >/dev/null
docker run -d --name kosmos-postgres --restart unless-stopped --network web \
  -e POSTGRES_PASSWORD="$PW" -e POSTGRES_DB=kosmos \
  -v kosmos_pgdata:/var/lib/postgresql/data postgres:17 >/dev/null
for i in $(seq 1 40); do docker exec kosmos-postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
echo "=== дамп Supabase -> restore в локальный (может занять пару минут) ==="
docker run --rm --network web postgres:17 pg_dump "$SUPA" --no-owner --no-acl -n kosmos -n vitrina \
  | docker exec -i kosmos-postgres psql -U postgres -d kosmos -q -v ON_ERROR_STOP=1 >/tmp/restore.log 2>&1 \
  || { echo "!!! RESTORE FAILED:"; tail -8 /tmp/restore.log; exit 1; }
SRC=$(docker run --rm --network web postgres:17 psql "$SUPA" -tAc "select count(*) from kosmos.objects")
DST=$(docker exec kosmos-postgres psql -U postgres -d kosmos -tAc "select count(*) from kosmos.objects")
echo "objects: supabase=$SRC  local=$DST"
[ "$SRC" = "$DST" ] || { echo "!!! COUNT MISMATCH — cutover отменён, Supabase не тронут"; exit 1; }
echo "=== cutover: .env -> локальный Postgres ==="
cp .env .env.supabase.bak
{ grep -vE "^(KOSMOS_DB_URL|KOSMOS_DB_SSL)=" .env; echo "KOSMOS_DB_URL=postgresql://postgres:$PW@kosmos-postgres:5432/kosmos"; echo "KOSMOS_DB_SSL=off"; } > .env.new && mv .env.new .env
echo "=== пересоздаю демон обогащения в сети web ==="
docker rm -f kosmos-enrich >/dev/null 2>&1 || true
docker run -d --name kosmos-enrich --restart unless-stopped --network web \
  -v /root/kosmos:/app -w /app node:22-alpine \
  sh -c 'while true; do node run.js ./scripts/build_baseline.js enrich; echo "[wrapper] проход $(date -u), пауза 300с"; sleep 300; done' >/dev/null
sleep 10
echo "=== логи демона (должен читать локальную базу) ==="
docker logs --tail 3 kosmos-enrich 2>&1
echo ""
echo "########## ГОТОВО: локальный Postgres, objects=$DST. Supabase цел (.env.supabase.bak) ##########"
