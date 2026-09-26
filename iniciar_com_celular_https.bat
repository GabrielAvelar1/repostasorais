@echo off
title Sistema de Provas Orais - Conexao HTTPS para Celular
chcp 65001 > nul
echo ========================================================
echo   SISTEMA DE PROVAS ORAIS - CONEXAO HTTPS PARA CELULAR
echo   (Permite microfone no iPhone Safari e Android)
echo ========================================================
echo.
echo 1. Iniciando servidor local na porta 3000...
start /b node server.js

echo.
echo 2. Criando link seguro HTTPS com cadeado verde para celulares...
echo (Aguarde alguns segundos para gerar o link...)
echo.

npx localtunnel --port 3000
pause
