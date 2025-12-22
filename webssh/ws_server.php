<?php
/**
 * WebSocket Server para SSH em tempo real
 * Requer: composer require cboden/ratchet
 * Executar: php ws_server.php
 */

require __DIR__ . '/vendor/autoload.php';

use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;
use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use phpseclib3\Net\SSH2;
use phpseclib3\Crypt\PublicKeyLoader;

class SSHWebSocket implements MessageComponentInterface {
    protected $clients;
    protected $sshConnections;

    public function __construct() {
        $this->clients = new \SplObjectStorage;
        $this->sshConnections = [];
        echo "WebSSH Server iniciado!\n";
    }

    public function onOpen(ConnectionInterface $conn) {
        $this->clients->attach($conn);
        echo "Nova conexão: {$conn->resourceId}\n";
    }

    public function onMessage(ConnectionInterface $from, $msg) {
        $data = json_decode($msg, true);
        
        if (!$data || !isset($data['type'])) {
            return;
        }

        switch ($data['type']) {
            case 'connect':
                $this->handleConnect($from, $data);
                break;
            case 'input':
                $this->handleInput($from, $data);
                break;
            case 'resize':
                $this->handleResize($from, $data);
                break;
            case 'disconnect':
                $this->handleDisconnect($from);
                break;
        }
    }

    protected function handleConnect(ConnectionInterface $conn, $data) {
        $host = $data['host'] ?? '';
        $port = intval($data['port'] ?? 22);
        $username = $data['username'] ?? '';
        $authType = $data['authType'] ?? 'password';
        $password = $data['password'] ?? '';
        $privateKey = $data['privateKey'] ?? '';
        $passphrase = $data['passphrase'] ?? '';

        try {
            $ssh = new SSH2($host, $port, 10);
            
            // Autenticação
            $authenticated = false;
            
            if ($authType === 'key' && !empty($privateKey)) {
                if (!empty($passphrase)) {
                    $key = PublicKeyLoader::load($privateKey, $passphrase);
                } else {
                    $key = PublicKeyLoader::load($privateKey);
                }
                $authenticated = $ssh->login($username, $key);
            } else {
                $authenticated = $ssh->login($username, $password);
            }

            if (!$authenticated) {
                $conn->send(json_encode([
                    'type' => 'error',
                    'message' => 'Falha na autenticação'
                ]));
                return;
            }

            // Configurar PTY
            $ssh->setTimeout(0);
            $ssh->enablePTY();
            
            // Definir tamanho do terminal
            $cols = $data['cols'] ?? 80;
            $rows = $data['rows'] ?? 24;
            $ssh->setWindowSize($cols, $rows);

            // Iniciar shell
            $ssh->exec('');

            // Armazenar conexão
            $this->sshConnections[$conn->resourceId] = [
                'ssh' => $ssh,
                'host' => $host,
                'username' => $username
            ];

            $conn->send(json_encode(['type' => 'connected']));

            // Iniciar loop de leitura
            $this->startReadLoop($conn);

        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'error',
                'message' => 'Erro: ' . $e->getMessage()
            ]));
        }
    }

    protected function startReadLoop(ConnectionInterface $conn) {
        // Em produção, usar ReactPHP para loop assíncrono
        // Esta é uma versão simplificada
        if (!isset($this->sshConnections[$conn->resourceId])) {
            return;
        }

        $ssh = $this->sshConnections[$conn->resourceId]['ssh'];
        
        // Ler output inicial
        $output = $ssh->read('', SSH2::READ_SIMPLE);
        if ($output) {
            $conn->send(json_encode([
                'type' => 'output',
                'data' => $output
            ]));
        }
    }

    protected function handleInput(ConnectionInterface $conn, $data) {
        if (!isset($this->sshConnections[$conn->resourceId])) {
            return;
        }

        $ssh = $this->sshConnections[$conn->resourceId]['ssh'];
        $input = $data['data'] ?? '';
        
        try {
            $ssh->write($input);
            
            // Ler resposta
            usleep(10000); // 10ms
            $output = $ssh->read('', SSH2::READ_SIMPLE);
            if ($output) {
                $conn->send(json_encode([
                    'type' => 'output',
                    'data' => $output
                ]));
            }
        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'error',
                'message' => 'Erro ao enviar comando'
            ]));
        }
    }

    protected function handleResize(ConnectionInterface $conn, $data) {
        if (!isset($this->sshConnections[$conn->resourceId])) {
            return;
        }

        $ssh = $this->sshConnections[$conn->resourceId]['ssh'];
        $cols = $data['cols'] ?? 80;
        $rows = $data['rows'] ?? 24;
        
        try {
            $ssh->setWindowSize($cols, $rows);
        } catch (\Exception $e) {
            // Ignorar erro de resize
        }
    }

    protected function handleDisconnect(ConnectionInterface $conn) {
        if (isset($this->sshConnections[$conn->resourceId])) {
            $ssh = $this->sshConnections[$conn->resourceId]['ssh'];
            $ssh->disconnect();
            unset($this->sshConnections[$conn->resourceId]);
        }
        
        $conn->send(json_encode(['type' => 'disconnected']));
    }

    public function onClose(ConnectionInterface $conn) {
        $this->handleDisconnect($conn);
        $this->clients->detach($conn);
        echo "Conexão {$conn->resourceId} fechada\n";
    }

    public function onError(ConnectionInterface $conn, \Exception $e) {
        echo "Erro: {$e->getMessage()}\n";
        $conn->close();
    }
}

// Iniciar servidor
$server = IoServer::factory(
    new HttpServer(
        new WsServer(
            new SSHWebSocket()
        )
    ),
    8080  // Porta WebSocket
);

echo "Servidor WebSocket rodando na porta 8080\n";
$server->run();
