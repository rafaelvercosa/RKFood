#!/usr/bin/env bash
# Roda as migrações + testes num Postgres local (sem Supabase).
# Uso: PGHOST=/caminho/socket PGPORT=5433 ./supabase/tests/run_local.sh
set -euo pipefail
cd "$(dirname "$0")"
P="psql -U ${PGUSER:-postgres} -X -q -v ON_ERROR_STOP=1"
$P -c "drop database if exists rkfood_test" -c "create database rkfood_test" >/dev/null
$P -d rkfood_test -f 00_simula_supabase.sql
for f in ../migrations/*.sql; do $P -d rkfood_test -f "$f"; done
$P -d rkfood_test -f 10_testes.sql 2>&1 | sed -n 's/.*NOTICE:  //p'
echo "Todos os testes do banco passaram."
