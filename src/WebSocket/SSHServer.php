<?php
/**
 * SSH WebSocket Server
 * Gerencia conexões SSH via WebSocket
 */

namespace App\WebSocket;

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use phpseclib3\Net\SSH2;
use phpseclib3\Net\SFTP;
use phpseclib3\Crypt\PublicKeyLoader;

class SSHServer implements MessageComponentInterface
{
    protected $clients;
    protected $sshConnections;
    protected $sftpConnections;

    public function __construct()
    {
        $this->clients = new \SplObjectStorage;
        $this->sshConnections = [];
        $this->sftpConnections = [];
    }

    public function onOpen(ConnectionInterface $conn)
    {
        $this->clients->attach($conn);
        echo "Nova conexão! ({$conn->resourceId})\n";
    }

    public function onMessage(ConnectionInterface $from, $msg)
    {
        $data = json_decode($msg, true);
        
        if (!$data || !isset($data['type'])) {
            return;
        }

        switch ($data['type']) {
            case 'auth':
                $this->handleAuth($from, $data);
                break;
            case 'input':
                $this->handleInput($from, $data);
                break;
            case 'resize':
                $this->handleResize($from, $data);
                break;
            case 'sftp':
                $this->handleSFTP($from, $data);
                break;
            case 'disconnect':
                $this->handleDisconnect($from);
                break;
        }
    }

    protected function handleAuth(ConnectionInterface $conn, array $data)
    {
        $sessionId = $data['session_id'] ?? '';
        
        if (empty($sessionId)) {
            $conn->send(json_encode([
                'type' => 'error',
                'data' => 'Session ID inválido'
            ]));
            return;
        }

        // Recuperar dados da sessão
        session_id($sessionId);
        session_start();
        $sshData = $_SESSION['ssh'] ?? null;
        session_write_close();

        if (!$sshData) {
            $conn->send(json_encode([
                'type' => 'error',
                'data' => 'Sessão expirada ou inválida'
            ]));
            return;
        }

        try {
            // Criar conexão SSH
            $ssh = new SSH2($sshData['host'], $sshData['port']);
            $ssh->setTimeout(30);

            $authenticated = false;

            // Autenticação com chave privada
            if (!empty($sshData['private_key'])) {
                try {
                    $key = PublicKeyLoader::load($sshData['private_key'], $sshData['password']);
                    $authenticated = $ssh->login($sshData['username'], $key);
                } catch (\Exception $e) {
                    $authenticated = false;
                }
            }

            // Autenticação com senha
            if (!$authenticated && !empty($sshData['password'])) {
                $authenticated = $ssh->login($sshData['username'], $sshData['password']);
            }

            if (!$authenticated) {
                $conn->send(json_encode([
                    'type' => 'error',
                    'data' => 'Falha na autenticação SSH'
                ]));
                return;
            }

            // Habilitar PTY para terminal interativo
            $ssh->enablePTY();
            $ssh->exec('');

            $this->sshConnections[$conn->resourceId] = [
                'ssh' => $ssh,
                'session_data' => $sshData
            ];

            // Criar conexão SFTP separada
            $sftp = new SFTP($sshData['host'], $sshData['port']);
            if (!empty($sshData['private_key'])) {
                try {
                    $key = PublicKeyLoader::load($sshData['private_key'], $sshData['password']);
                    $sftp->login($sshData['username'], $key);
                } catch (\Exception $e) {
                    $sftp->login($sshData['username'], $sshData['password']);
                }
            } else {
                $sftp->login($sshData['username'], $sshData['password']);
            }
            $this->sftpConnections[$conn->resourceId] = $sftp;

            // Iniciar leitura de output
            $this->startOutputReader($conn);

        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'error',
                'data' => 'Erro ao conectar: ' . $e->getMessage()
            ]));
        }
    }

    protected function handleInput(ConnectionInterface $conn, array $data)
    {
        if (!isset($this->sshConnections[$conn->resourceId])) {
            return;
        }

        $ssh = $this->sshConnections[$conn->resourceId]['ssh'];
        $input = $data['data'] ?? '';

        if (!empty($input)) {
            $ssh->write($input);
        }
    }

    protected function handleResize(ConnectionInterface $conn, array $data)
    {
        if (!isset($this->sshConnections[$conn->resourceId])) {
            return;
        }

        $ssh = $this->sshConnections[$conn->resourceId]['ssh'];
        $cols = $data['cols'] ?? 80;
        $rows = $data['rows'] ?? 24;

        $ssh->setWindowSize($cols, $rows);
    }

    protected function handleSFTP(ConnectionInterface $conn, array $data)
    {
        if (!isset($this->sftpConnections[$conn->resourceId])) {
            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => $data['action'],
                'success' => false,
                'error' => 'Conexão SFTP não disponível'
            ]));
            return;
        }

        $sftp = $this->sftpConnections[$conn->resourceId];
        $action = $data['action'] ?? '';

        switch ($action) {
            case 'list':
                $this->sftpList($conn, $sftp, $data['path'] ?? '/');
                break;
            case 'download':
                $this->sftpDownload($conn, $sftp, $data['path']);
                break;
            case 'upload':
                $this->sftpUpload($conn, $sftp, $data['path'], $data['data']);
                break;
            case 'delete':
                $this->sftpDelete($conn, $sftp, $data['path'], $data['is_directory'] ?? false);
                break;
            case 'mkdir':
                $this->sftpMkdir($conn, $sftp, $data['path']);
                break;
        }
    }

    protected function sftpList(ConnectionInterface $conn, SFTP $sftp, string $path)
    {
        try {
            $files = $sftp->nlist($path);
            $result = [];

            if ($files === false) {
                $conn->send(json_encode([
                    'type' => 'sftp',
                    'action' => 'list',
                    'path' => $path,
                    'data' => [],
                    'error' => 'Não foi possível listar o diretório'
                ]));
                return;
            }

            foreach ($files as $file) {
                if ($file === '.' || $file === '..') {
                    continue;
                }

                $fullPath = rtrim($path, '/') . '/' . $file;
                $stat = $sftp->stat($fullPath);

                $result[] = [
                    'name' => $file,
                    'type' => $sftp->is_dir($fullPath) ? 'directory' : 'file',
                    'size' => $stat['size'] ?? 0,
                    'modified' => isset($stat['mtime']) ? date('Y-m-d H:i', $stat['mtime']) : ''
                ];
            }

            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'list',
                'path' => $path,
                'data' => $result
            ]));

        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'list',
                'path' => $path,
                'data' => [],
                'error' => $e->getMessage()
            ]));
        }
    }

    protected function sftpDownload(ConnectionInterface $conn, SFTP $sftp, string $path)
    {
        try {
            $content = $sftp->get($path);
            
            if ($content === false) {
                $conn->send(json_encode([
                    'type' => 'sftp',
                    'action' => 'download',
                    'success' => false,
                    'error' => 'Não foi possível baixar o arquivo'
                ]));
                return;
            }

            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'download',
                'filename' => basename($path),
                'data' => base64_encode($content)
            ]));

        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'download',
                'success' => false,
                'error' => $e->getMessage()
            ]));
        }
    }

    protected function sftpUpload(ConnectionInterface $conn, SFTP $sftp, string $path, string $base64Data)
    {
        try {
            $content = base64_decode($base64Data);
            $result = $sftp->put($path, $content);

            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'upload',
                'success' => $result !== false,
                'error' => $result === false ? 'Falha no upload' : null
            ]));

        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'upload',
                'success' => false,
                'error' => $e->getMessage()
            ]));
        }
    }

    protected function sftpDelete(ConnectionInterface $conn, SFTP $sftp, string $path, bool $isDirectory)
    {
        try {
            if ($isDirectory) {
                $result = $sftp->rmdir($path);
            } else {
                $result = $sftp->delete($path);
            }

            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'delete',
                'success' => $result,
                'error' => !$result ? 'Falha ao deletar' : null
            ]));

        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'delete',
                'success' => false,
                'error' => $e->getMessage()
            ]));
        }
    }

    protected function sftpMkdir(ConnectionInterface $conn, SFTP $sftp, string $path)
    {
        try {
            $result = $sftp->mkdir($path);

            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'mkdir',
                'success' => $result,
                'error' => !$result ? 'Falha ao criar diretório' : null
            ]));

        } catch (\Exception $e) {
            $conn->send(json_encode([
                'type' => 'sftp',
                'action' => 'mkdir',
                'success' => false,
                'error' => $e->getMessage()
            ]));
        }
    }

    protected function startOutputReader(ConnectionInterface $conn)
    {
        if (!isset($this->sshConnections[$conn->resourceId])) {
            return;
        }

        $ssh = $this->sshConnections[$conn->resourceId]['ssh'];

        // Em uma implementação real, você usaria um loop de eventos
        // ou ReactPHP para leitura assíncrona
        // Este é um exemplo simplificado
        
        $output = $ssh->read('', SSH2::READ_REGEX);
        if (!empty($output)) {
            $conn->send(json_encode([
                'type' => 'output',
                'data' => $output
            ]));
        }
    }

    protected function handleDisconnect(ConnectionInterface $conn)
    {
        $this->cleanupConnection($conn);
        $conn->send(json_encode(['type' => 'disconnect']));
        $conn->close();
    }

    protected function cleanupConnection(ConnectionInterface $conn)
    {
        if (isset($this->sshConnections[$conn->resourceId])) {
            $ssh = $this->sshConnections[$conn->resourceId]['ssh'];
            $ssh->disconnect();
            unset($this->sshConnections[$conn->resourceId]);
        }

        if (isset($this->sftpConnections[$conn->resourceId])) {
            $this->sftpConnections[$conn->resourceId]->disconnect();
            unset($this->sftpConnections[$conn->resourceId]);
        }
    }

    public function onClose(ConnectionInterface $conn)
    {
        $this->cleanupConnection($conn);
        $this->clients->detach($conn);
        echo "Conexão {$conn->resourceId} encerrada\n";
    }

    public function onError(ConnectionInterface $conn, \Exception $e)
    {
        echo "Erro: {$e->getMessage()}\n";
        $this->cleanupConnection($conn);
        $conn->close();
    }
}
