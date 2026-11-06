# instalar-offline.ps1 — baixa os arquivos do vendor para o modo 100% offline.
# Uso: powershell -ExecutionPolicy Bypass -File tools\instalar-offline.ps1
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $raiz

New-Item -ItemType Directory -Force -Path vendor\langs | Out-Null

Write-Host "Baixando tesseract.js v7 (dist)…"
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js" -OutFile vendor\tesseract.min.js
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js" -OutFile vendor\worker.min.js

Write-Host "Baixando core LSTM (SIMD)…"
Invoke-WebRequest "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js" -OutFile vendor\tesseract-core-simd-lstm.wasm.js

Set-Content vendor\origem.json '{"core": "local", "lang": "local"}'
Write-Host "Pronto: core local instalado — extensão 100% offline."
