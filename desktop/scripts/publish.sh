#!/bin/bash
# Publica o instalador + latest.yml no feed de atualização (mesmo servidor do Norte Vendas).
# Rodar depois de `npm run dist`, de dentro de desktop/.
set -euo pipefail
DIST_DIR="$(dirname "$0")/../dist"
REMOTE="root@185.193.66.240"
REMOTE_PATH="/home/ntb/web/updates.norteparanegocios.com.br/public_html/ntb-estoque-desktop"
SSH="ssh -i $HOME/.ssh/notebook_contabo_key"
[ -f "$DIST_DIR/latest.yml" ] || { echo "latest.yml não encontrado: rode npm run dist"; exit 1; }
EXE_NAME="$(sed -n 's/^path: //p' "$DIST_DIR/latest.yml")"
[ -f "$DIST_DIR/$EXE_NAME" ] || { echo "instalador $EXE_NAME não encontrado"; exit 1; }
$SSH "$REMOTE" "mkdir -p '$REMOTE_PATH'"
scp -i ~/.ssh/notebook_contabo_key "$DIST_DIR/$EXE_NAME" "$REMOTE:$REMOTE_PATH/"
[ -f "$DIST_DIR/$EXE_NAME.blockmap" ] && scp -i ~/.ssh/notebook_contabo_key "$DIST_DIR/$EXE_NAME.blockmap" "$REMOTE:$REMOTE_PATH/"
# latest.yml por último: nenhum app vê a versão nova antes do instalador estar no servidor.
scp -i ~/.ssh/notebook_contabo_key "$DIST_DIR/latest.yml" "$REMOTE:$REMOTE_PATH/"
$SSH "$REMOTE" "cp -f '$REMOTE_PATH/$EXE_NAME' '$REMOTE_PATH/Norte-Estoque-Setup.exe' && chown -R ntb:ntb '$REMOTE_PATH'"
echo "Publicado: https://updates.norteparanegocios.com.br/ntb-estoque-desktop/Norte-Estoque-Setup.exe"
