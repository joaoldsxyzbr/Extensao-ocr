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

echo "Baixando modelo do idioma (por, fast)…"
curl -sL https://tessdata.projectnaptha.com/4.0.0_fast/por.traineddata.gz -o vendor/langs/por.traineddata.gz

echo '{"core": "local", "lang": "local"}' > vendor/origem.json
echo "Pronto: vendor completo, extensão 100% offline."
