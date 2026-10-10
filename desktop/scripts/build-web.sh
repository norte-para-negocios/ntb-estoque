#!/bin/bash
# Build do Next para o app desktop: standalone em desktop/web, com o endereço local embutido.
# O .env.local do repositório fica de fora (tem chaves de produção que nunca podem ir no instalador).
set -euo pipefail
cd "$(dirname "$0")/../.."
RAIZ="$(pwd)"
bash desktop/scripts/compilar-compartilhado.sh

restaurar() { [ -f "$RAIZ/.env.local.fora-do-desktop" ] && mv "$RAIZ/.env.local.fora-do-desktop" "$RAIZ/.env.local"; true; }
trap restaurar EXIT
[ -f .env.local ] && mv .env.local .env.local.fora-do-desktop

rm -rf .next-desktop
NTB_DESKTOP=1 NEXT_PUBLIC_DESKTOP=1 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54398 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=ntb-desktop-anon \
NEXT_PUBLIC_APP_URL=http://127.0.0.1:54398 \
  npx next build

rm -rf desktop/web
cp -R .next-desktop/standalone desktop/web
mkdir -p desktop/web/.next-desktop
cp -R .next-desktop/static desktop/web/.next-desktop/static
[ -d public ] && cp -R public desktop/web/public
# O Turbopack cria atalhos (symlink) para pacotes externos, ex. .next-desktop/node_modules/
# @react-pdf/renderer-<hash>. Atalho do Mac não sobrevive no instalador do Windows (PDF/exportação
# quebrariam), então vira cópia de verdade.
for atalho in $(find desktop/web -type l); do
  alvo="$(realpath "$atalho")"
  rm "$atalho"
  cp -RL "$alvo" "$atalho"
done
[ -z "$(find desktop/web -type l)" ] || { echo "ainda há atalhos em desktop/web"; exit 1; }
# Nada de .env nem de chave de produção dentro do app.
find desktop/web -name '.env*' -not -path '*/node_modules/*' -print -delete
node desktop/scripts/conferir-segredos.mjs .env.local.fora-do-desktop desktop/web
echo "web pronto em desktop/web"
