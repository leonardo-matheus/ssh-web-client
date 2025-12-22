<?php
/**
 * WebSocket Server Bootstrap
 * Inicia o servidor WebSocket para conexões SSH
 */

require __DIR__ . '/../vendor/autoload.php';

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use App\WebSocket\SSHServer;

$port = $argv[1] ?? 8080;

echo "===========================================\n";
echo "   SSH Web Client - WebSocket Server\n";
echo "===========================================\n";
echo "Iniciando servidor na porta {$port}...\n\n";

$server = IoServer::factory(
    new HttpServer(
        new WsServer(
            new SSHServer()
        )
    ),
    $port
);

echo "✓ Servidor WebSocket rodando em ws://localhost:{$port}\n";
echo "Pressione Ctrl+C para parar o servidor.\n\n";

$server->run();
