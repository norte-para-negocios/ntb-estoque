#!/bin/bash
# Gera desktop/schema/estoque.sql e frio.sql a partir da produção (somente estrutura, sem dados).
# Rodar a cada release do desktop que acompanhe migrations novas.
set -euo pipefail
cd "$(dirname "$0")/.."
SSH="ssh -i $HOME/.ssh/notebook_contabo_key root@185.193.66.240"
TMP="$(mktemp -d)"
$SSH "docker exec supabase-db pg_dump -U supabase_admin -d postgres --schema-only --no-owner -n public" > "$TMP/estoque.sql"
$SSH "sudo -u postgres pg_dump -d ntb_frio --schema-only --no-owner --no-privileges -n public 2>/dev/null" > "$TMP/frio.sql"
node scripts/limpar-schema.mjs "$TMP/estoque.sql" schema/estoque.sql
node scripts/limpar-schema.mjs "$TMP/frio.sql" schema/frio.sql
rm -rf "$TMP"
