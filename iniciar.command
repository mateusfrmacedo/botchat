#!/bin/bash

# Abre o projeto a partir da pasta onde este arquivo está salvo.
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_APP="$PROJECT_DIR/node_modules/electron/dist/Electron.app"
ELECTRON_BIN="$ELECTRON_APP/Contents/MacOS/Electron"

cd "$PROJECT_DIR" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "Erro: o Node.js/npm não foi encontrado neste Mac."
  read -r -p "Pressione Enter para fechar..."
  exit 1
fi

# Reinstala o Electron somente se o executável não estiver presente.
# A verificação `codesign` do macOS falha para a distribuição do Electron via npm
# mesmo quando ela funciona corretamente, o que tornava toda abertura mais lenta.
if [ ! -x "$ELECTRON_BIN" ]; then
  echo "O Electron não foi encontrado. Baixando uma cópia nova..."
  rm -rf "$PROJECT_DIR/node_modules/electron"
  npm install --include=dev
  if [ $? -ne 0 ]; then
    echo "Não foi possível reinstalar as dependências."
    read -r -p "Pressione Enter para fechar..."
    exit 1
  fi
fi

# Permite que o macOS execute o Electron baixado para este projeto.
xattr -dr com.apple.quarantine "$PROJECT_DIR/node_modules/electron" 2>/dev/null || true

echo "Iniciando BotChat..."
npm run dev

STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo
  echo "O programa foi encerrado com erro (código $STATUS)."
  read -r -p "Pressione Enter para fechar..."
fi

exit $STATUS
