#!/usr/bin/env bash
# verify-local.sh — sobe um Postgres descartável, aplica o schema e roda o
# contract-test de segurança. Serve para validar os scripts SEM banco de produção.
#
#   bash .planning/seguranca/verify-local.sh
#
# Requer Docker. Não toca em nada fora do container, que é destruído no fim.
set -euo pipefail

CT=aios-verify
PORT=55433
export PGPASSWORD=verify
PSQL="docker exec -i $CT psql -v ON_ERROR_STOP=1 -U postgres -d aios"
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"

limpar() { docker rm -f $CT >/dev/null 2>&1 || true; }
trap limpar EXIT

echo "→ subindo postgres descartável..."
limpar
docker run -d --rm --name $CT -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=aios \
  -p $PORT:5432 postgres:18-alpine >/dev/null

for i in $(seq 1 45); do
  docker exec $CT pg_isready -U postgres -d aios >/dev/null 2>&1 && break
  sleep 1
done

echo "→ aplicando schema base..."
$PSQL < "$RAIZ/sofia-demo/sql/DRAFT-prontuario-modelo.sql" >/dev/null

echo "→ aplicando módulos..."
for f in "$RAIZ"/aios-painel/.planning/*/sql/001-*.sql; do
  echo "   $(basename "$(dirname "$(dirname "$f")")")/$(basename "$f")"
  $PSQL < "$f" >/dev/null || echo "   ⚠️  falhou (dependência ausente) — seguindo"
done

echo "→ bootstrap (roles + fn_login_lookup)..."
$PSQL < "$RAIZ/aios-painel/.planning/seguranca/000-bootstrap.sql" >/dev/null

echo "→ rate limit..."
$PSQL < "$RAIZ/aios-painel/.planning/seguranca/003-rate-limit.sql" >/dev/null

echo "→ lockdown..."
$PSQL < "$RAIZ/aios-painel/.planning/seguranca/001-lockdown.sql"

echo "→ seed mínimo (2 clínicas, para provar o cruzamento)..."
$PSQL <<'SQL' >/dev/null
INSERT INTO clinicas (nome) VALUES ('[TESTE] Clinica A'), ('[TESTE] Clinica B')
  ON CONFLICT DO NOTHING;
SQL

echo
echo "→ CONTRACT-TEST DE SEGURANÇA"
echo "────────────────────────────────────────"
$PSQL < "$RAIZ/aios-painel/.planning/seguranca/002-contract-test.sql"
echo "────────────────────────────────────────"
echo "✅ contract-test concluído sem exceção."
