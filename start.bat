@echo off
echo ===========================================
echo    SSH Web Client - Inicializacao
echo ===========================================
echo.

REM Verificar se o Composer esta instalado
where composer >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Composer nao encontrado. Por favor, instale o Composer.
    echo Download: https://getcomposer.org/download/
    pause
    exit /b 1
)

REM Verificar se o PHP esta instalado
where php >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] PHP nao encontrado. Por favor, instale o PHP 8.0+.
    pause
    exit /b 1
)

REM Instalar dependencias se necessario
if not exist "vendor" (
    echo Instalando dependencias...
    composer install
    echo.
)

echo Iniciando servidores...
echo.

REM Iniciar servidor WebSocket em background
start "WebSocket Server" cmd /c "php bin/server.php 8080"

REM Aguardar um pouco
timeout /t 2 /nobreak >nul

REM Iniciar servidor PHP embutido
echo Servidor Web: http://localhost:8000
echo Servidor WebSocket: ws://localhost:8080
echo.
echo Pressione Ctrl+C para parar os servidores.
echo.

php -S localhost:8000 -t public
