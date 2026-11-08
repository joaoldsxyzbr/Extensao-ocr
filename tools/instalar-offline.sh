#!/usr/bin/env bash
# instalar-offline.sh — baixa os arquivos do vendor para o modo 100% offline.
# Uso: bash tools/instalar-offline.sh  (na raiz do projeto)
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p vendor/langs

echo "Baixando tesseract.js v7 (dist)…"
curl -sL https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js -o vendor/tesseract.min.js
curl -sL https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js -o vendor/worker.min.js

echo "Baixando core LSTM (SIMD)…"
curl -sL https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js -o vendor/tesseract-core-simd-lstm.wasm.js

# lang "auto" = usa o b64 embutido no repo (vendor/langs/por.traineddata.gz.b64).
echo '{"core": "local", "lang": "auto"}' > vendor/origem.json
echo "Pronto: core local instalado — extensão 100% offline."
