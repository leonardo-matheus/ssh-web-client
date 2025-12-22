<?php
/**
 * WebSSH - Handler PHP para conexões SSH/SFTP
 * Usa phpseclib para conexões SSH
 */

session_start();
error_reporting(0);

// Verificar se phpseclib está instalado
if (!file_exists(__DIR__ . '/vendor/autoload.php')) {
    // Se não tiver composer, usar versão standalone
    if (!file_exists(__DIR__ . '/phpseclib/Net/SSH2.php')) {
        die(json_encode(['error' => 'phpseclib não encontrado. Execute: composer require phpseclib/phpseclib:~3.0']));
    }
    // Autoload simples para versão standalone
    spl_autoload_register(function ($class) {
        $file = __DIR__ . '/' . str_replace('\\', '/', $class) . '.php';
        if (file_exists($file)) {
            require $file;
        }
    });
} else {
    require __DIR__ . '/vendor/autoload.php';
}

use phpseclib3\Net\SSH2;
use phpseclib3\Net\SFTP;
use phpseclib3\Crypt\PublicKeyLoader;

header('Content-Type: application/json');

// Obter dados da requisição
$input = file_get_contents('php://input');
$data = json_decode($input, true);

// Para upload de arquivos
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $data = $_POST;
}

// Para download
if ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($_GET['action'])) {
    $data = $_GET;
}

$action = $data['action'] ?? '';

switch ($action) {
    case 'connect':
        handleConnect($data);
        break;
    case 'write':
        handleWrite($data);
        break;
    case 'read':
        handleRead($data);
        break;
    case 'disconnect':
        handleDisconnect($data);
        break;
    case 'listFiles':
        handleListFiles($data);
        break;
    case 'download':
        handleDownload($data);
        break;
    case 'upload':
        handleUpload($data);
        break;
    case 'mkdir':
        handleMkdir($data);
        break;
    default:
        echo json_encode(['error' => 'Ação inválida']);
}

/**
 * Conectar ao servidor SSH
 */
function handleConnect($data) {
    $host = $data['host'] ?? '';
    $port = intval($data['port'] ?? 22);
    $username = $data['username'] ?? '';
    $authType = $data['authType'] ?? 'password';
    $password = $data['password'] ?? '';
    $privateKey = $data['privateKey'] ?? '';
    $passphrase = $data['passphrase'] ?? '';

    if (empty($host) || empty($username)) {
        echo json_encode(['success' => false, 'error' => 'Host e usuário são obrigatórios']);
        return;
    }

    try {
        $ssh = new SSH2($host, $port, 10); // 10 segundos timeout
        
        // Autenticação
        $authenticated = false;
        
        if ($authType === 'key' && !empty($privateKey)) {
            // Autenticação por chave
            try {
                if (!empty($passphrase)) {
                    $key = PublicKeyLoader::load($privateKey, $passphrase);
                } else {
                    $key = PublicKeyLoader::load($privateKey);
                }
                $authenticated = $ssh->login($username, $key);
            } catch (Exception $e) {
                echo json_encode(['success' => false, 'error' => 'Erro na chave privada: ' . $e->getMessage()]);
                return;
            }
        } else {
            // Autenticação por senha
            $authenticated = $ssh->login($username, $password);
        }

        if (!$authenticated) {
            echo json_encode(['success' => false, 'error' => 'Falha na autenticação. Verifique usuário e senha.']);
            return;
        }

        // Iniciar shell interativo
        $ssh->setTimeout(0);
        $ssh->enablePTY();
        $ssh->exec('');

        // Gerar ID de sessão único
        $sessionId = bin2hex(random_bytes(16));
        
        // Armazenar conexão na sessão
        $_SESSION['ssh_connections'][$sessionId] = [
            'host' => $host,
            'port' => $port,
            'username' => $username,
            'password' => $password, // Necessário para reconexão SFTP
            'privateKey' => $privateKey,
            'passphrase' => $passphrase,
            'authType' => $authType,
            'connected' => true,
            'created' => time()
        ];

        // Armazenar objeto SSH (não funciona bem em sessão, mas tentamos)
        // Para produção, use Redis ou similar
        $GLOBALS['ssh_objects'][$sessionId] = $ssh;
        
        // Salvar em arquivo temporário para persistência
        $tempFile = sys_get_temp_dir() . '/webssh_' . $sessionId;
        file_put_contents($tempFile, serialize([
            'host' => $host,
            'port' => $port,
            'username' => $username,
            'password' => $password,
            'privateKey' => $privateKey,
            'passphrase' => $passphrase,
            'authType' => $authType
        ]));

        echo json_encode([
            'success' => true,
            'sessionId' => $sessionId,
            'message' => 'Conectado com sucesso'
        ]);

    } catch (Exception $e) {
        echo json_encode([
            'success' => false, 
            'error' => 'Erro ao conectar: ' . $e->getMessage()
        ]);
    }
}

/**
 * Enviar comando para o SSH
 */
function handleWrite($data) {
    $sessionId = $data['sessionId'] ?? '';
    $input = $data['data'] ?? '';

    if (empty($sessionId)) {
        echo json_encode(['success' => false, 'error' => 'Sessão inválida']);
        return;
    }

    try {
        $ssh = getSSHConnection($sessionId);
        if (!$ssh) {
            echo json_encode(['success' => false, 'error' => 'Conexão não encontrada']);
            return;
        }

        $ssh->write($input);
        echo json_encode(['success' => true]);

    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Ler output do SSH
 */
function handleRead($data) {
    $sessionId = $data['sessionId'] ?? '';

    if (empty($sessionId)) {
        echo json_encode(['success' => false, 'error' => 'Sessão inválida']);
        return;
    }

    try {
        $ssh = getSSHConnection($sessionId);
        if (!$ssh) {
            echo json_encode(['success' => false, 'disconnected' => true]);
            return;
        }

        $output = $ssh->read('', SSH2::READ_SIMPLE);
        echo json_encode(['success' => true, 'output' => $output]);

    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Desconectar
 */
function handleDisconnect($data) {
    $sessionId = $data['sessionId'] ?? '';

    if (!empty($sessionId)) {
        // Limpar sessão
        if (isset($_SESSION['ssh_connections'][$sessionId])) {
            unset($_SESSION['ssh_connections'][$sessionId]);
        }
        
        // Limpar arquivo temporário
        $tempFile = sys_get_temp_dir() . '/webssh_' . $sessionId;
        if (file_exists($tempFile)) {
            unlink($tempFile);
        }
    }

    echo json_encode(['success' => true, 'message' => 'Desconectado']);
}

/**
 * Listar arquivos via SFTP
 */
function handleListFiles($data) {
    $sessionId = $data['sessionId'] ?? '';
    $path = $data['path'] ?? '/';

    try {
        $sftp = getSFTPConnection($sessionId);
        if (!$sftp) {
            echo json_encode(['success' => false, 'error' => 'Conexão SFTP falhou']);
            return;
        }

        $files = $sftp->nlist($path);
        if ($files === false) {
            echo json_encode(['success' => false, 'error' => 'Não foi possível listar o diretório']);
            return;
        }

        $result = [];
        foreach ($files as $file) {
            if ($file === '.' || $file === '..') continue;
            
            $fullPath = rtrim($path, '/') . '/' . $file;
            $stat = $sftp->stat($fullPath);
            
            $result[] = [
                'name' => $file,
                'isDir' => $sftp->is_dir($fullPath),
                'size' => formatBytes($stat['size'] ?? 0),
                'permissions' => $stat['permissions'] ?? 0,
                'modified' => date('Y-m-d H:i', $stat['mtime'] ?? 0)
            ];
        }

        // Ordenar: diretórios primeiro
        usort($result, function($a, $b) {
            if ($a['isDir'] === $b['isDir']) {
                return strcasecmp($a['name'], $b['name']);
            }
            return $b['isDir'] - $a['isDir'];
        });

        echo json_encode(['success' => true, 'files' => $result]);

    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Download de arquivo
 */
function handleDownload($data) {
    $sessionId = $data['sessionId'] ?? '';
    $path = $data['path'] ?? '';
    $filename = $data['filename'] ?? basename($path);

    try {
        $sftp = getSFTPConnection($sessionId);
        if (!$sftp) {
            die('Erro: Conexão SFTP falhou');
        }

        $content = $sftp->get($path);
        if ($content === false) {
            die('Erro: Não foi possível ler o arquivo');
        }

        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . strlen($content));
        echo $content;
        exit;

    } catch (Exception $e) {
        die('Erro: ' . $e->getMessage());
    }
}

/**
 * Upload de arquivo
 */
function handleUpload($data) {
    $sessionId = $data['sessionId'] ?? '';
    $path = $data['path'] ?? '/';

    if (!isset($_FILES['file'])) {
        echo json_encode(['success' => false, 'error' => 'Nenhum arquivo enviado']);
        return;
    }

    try {
        $sftp = getSFTPConnection($sessionId);
        if (!$sftp) {
            echo json_encode(['success' => false, 'error' => 'Conexão SFTP falhou']);
            return;
        }

        $file = $_FILES['file'];
        $remotePath = rtrim($path, '/') . '/' . $file['name'];
        
        $result = $sftp->put($remotePath, file_get_contents($file['tmp_name']));
        
        if ($result) {
            echo json_encode(['success' => true, 'message' => 'Arquivo enviado']);
        } else {
            echo json_encode(['success' => false, 'error' => 'Falha ao enviar arquivo']);
        }

    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Criar diretório
 */
function handleMkdir($data) {
    $sessionId = $data['sessionId'] ?? '';
    $path = $data['path'] ?? '';

    try {
        $sftp = getSFTPConnection($sessionId);
        if (!$sftp) {
            echo json_encode(['success' => false, 'error' => 'Conexão SFTP falhou']);
            return;
        }

        if ($sftp->mkdir($path)) {
            echo json_encode(['success' => true]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Falha ao criar diretório']);
        }

    } catch (Exception $e) {
        echo json_encode(['success' => false, 'error' => $e->getMessage()]);
    }
}

/**
 * Obter conexão SSH existente ou reconectar
 */
function getSSHConnection($sessionId) {
    $tempFile = sys_get_temp_dir() . '/webssh_' . $sessionId;
    
    if (!file_exists($tempFile)) {
        return null;
    }

    $data = unserialize(file_get_contents($tempFile));
    
    $ssh = new SSH2($data['host'], $data['port'], 10);
    
    if ($data['authType'] === 'key' && !empty($data['privateKey'])) {
        if (!empty($data['passphrase'])) {
            $key = PublicKeyLoader::load($data['privateKey'], $data['passphrase']);
        } else {
            $key = PublicKeyLoader::load($data['privateKey']);
        }
        if (!$ssh->login($data['username'], $key)) {
            return null;
        }
    } else {
        if (!$ssh->login($data['username'], $data['password'])) {
            return null;
        }
    }

    $ssh->setTimeout(0.5);
    $ssh->enablePTY();
    $ssh->exec('');

    return $ssh;
}

/**
 * Obter conexão SFTP
 */
function getSFTPConnection($sessionId) {
    $tempFile = sys_get_temp_dir() . '/webssh_' . $sessionId;
    
    if (!file_exists($tempFile)) {
        return null;
    }

    $data = unserialize(file_get_contents($tempFile));
    
    $sftp = new SFTP($data['host'], $data['port'], 10);
    
    if ($data['authType'] === 'key' && !empty($data['privateKey'])) {
        if (!empty($data['passphrase'])) {
            $key = PublicKeyLoader::load($data['privateKey'], $data['passphrase']);
        } else {
            $key = PublicKeyLoader::load($data['privateKey']);
        }
        if (!$sftp->login($data['username'], $key)) {
            return null;
        }
    } else {
        if (!$sftp->login($data['username'], $data['password'])) {
            return null;
        }
    }

    return $sftp;
}

/**
 * Formatar bytes
 */
function formatBytes($bytes, $precision = 2) {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    
    $bytes = max($bytes, 0);
    $pow = floor(($bytes ? log($bytes) : 0) / log(1024));
    $pow = min($pow, count($units) - 1);
    
    $bytes /= pow(1024, $pow);
    
    return round($bytes, $precision) . ' ' . $units[$pow];
}
