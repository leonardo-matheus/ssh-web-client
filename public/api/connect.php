<?php
/**
 * SSH Connection API
 * Endpoint para iniciar conexão SSH
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

require_once __DIR__ . '/../../vendor/autoload.php';

use phpseclib3\Net\SSH2;
use phpseclib3\Crypt\PublicKeyLoader;

// Receber dados JSON
$input = json_decode(file_get_contents('php://input'), true);

if (!$input) {
    echo json_encode(['success' => false, 'error' => 'Dados inválidos']);
    exit;
}

$host = $input['host'] ?? '';
$port = $input['port'] ?? 22;
$username = $input['username'] ?? '';
$password = $input['password'] ?? '';
$privateKey = $input['private_key'] ?? null;

// Validação
if (empty($host) || empty($username)) {
    echo json_encode(['success' => false, 'error' => 'Host e usuário são obrigatórios']);
    exit;
}

try {
    // Tentar conexão SSH
    $ssh = new SSH2($host, $port);
    $ssh->setTimeout(10);
    
    $authenticated = false;
    
    // Autenticação com chave privada
    if (!empty($privateKey)) {
        try {
            $key = PublicKeyLoader::load($privateKey, $password);
            $authenticated = $ssh->login($username, $key);
        } catch (Exception $e) {
            // Fallback para senha
            $authenticated = false;
        }
    }
    
    // Autenticação com senha
    if (!$authenticated && !empty($password)) {
        $authenticated = $ssh->login($username, $password);
    }
    
    if (!$authenticated) {
        echo json_encode(['success' => false, 'error' => 'Falha na autenticação. Verifique usuário e senha.']);
        exit;
    }
    
    // Gerar ID de sessão
    $sessionId = bin2hex(random_bytes(32));
    
    // Salvar credenciais na sessão (em produção, use algo mais seguro como Redis)
    session_id($sessionId);
    session_start();
    $_SESSION['ssh'] = [
        'host' => $host,
        'port' => $port,
        'username' => $username,
        'password' => $password,
        'private_key' => $privateKey,
        'connected_at' => time()
    ];
    session_write_close();
    
    echo json_encode([
        'success' => true,
        'session_id' => $sessionId,
        'message' => 'Conexão estabelecida com sucesso'
    ]);
    
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'error' => 'Erro de conexão: ' . $e->getMessage()
    ]);
}
