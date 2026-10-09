#!/bin/bash
# Compila as libs puras do canal (lib/offline) para o processo principal do Electron (CommonJS).
set -euo pipefail
cd "$(dirname "$0")/../.."
npx tsc --outDir desktop/electron/compartilhado --module commonjs --target es2022 --skipLibCheck --strict --types node \
  lib/offline/ids-provisorios.ts lib/offline/pareamento.ts lib/offline/serializacao.ts
