#!/bin/bash

echo "==========================================="
echo "   SSH Web Client - Inicialização"
echo "==========================================="
echo

# Verificar se o Composer está instalado
if ! command -v composer &> /dev/null; then
    echo "[ERRO] Composer não encontrado. Por favor, instale o Composer."
    echo "Download: https://getcomposer.org/download/"
    exit 1
fi

# Verificar se o PHP está instalado
if ! command -v php &> /dev/null; then
    echo "[ERRO] PHP não encontrado. Por favor, instale o PHP 8.0+."
    exit 1
fi

# Instalar dependências se necessário
if [ ! -d "vendor" ]; then
    echo "Instalando dependências..."
    composer install
    echo
fi

echo "Iniciando servidores..."
echo

# Iniciar servidor WebSocket em background
php bin/server.php 8080 &
WS_PID=$!

# Aguardar um pouco
sleep 2

echo "Servidor Web: http://localhost:8000"
echo "Servidor WebSocket: ws://localhost:8080"
echo
echo "Pressione Ctrl+C para parar os servidores."
echo

# Função para limpar ao sair
cleanup() {
    echo
    echo "Encerrando servidores..."
    kill $WS_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

# Iniciar servidor PHP embutido
php -S localhost:8000 -t public

# Limpar ao final
cleanup
