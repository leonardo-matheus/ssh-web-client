# 🖥️ SSH Web Client

Um cliente SSH e SFTP baseado em web, similar ao [ssheasy.com](https://ssheasy.com/), desenvolvido em PHP.

## ✨ Funcionalidades

- 🔐 Conexão SSH via navegador
- 📁 Gerenciador de arquivos SFTP integrado
- ⌨️ Terminal interativo com xterm.js
- 🔑 Suporte a autenticação por senha ou chave privada
- 📤 Upload e download de arquivos
- 🗂️ Criar/deletar pastas e arquivos
- 🖥️ Modo tela cheia
- 🎨 Interface moderna e responsiva

## 📋 Requisitos

- PHP 8.0 ou superior
- Composer
- Extensões PHP:
  - `openssl`
  - `sockets`
  - `mbstring`

## 🚀 Instalação

### 1. Clonar/Baixar o projeto

```bash
cd c:\Users\leonardo.silva\Software\test\ssh-web-client
```

### 2. Instalar dependências

```bash
composer install
```

### 3. Iniciar os servidores

**Windows:**
```bash
start.bat
```

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

### 4. Acessar no navegador

Abra: http://localhost:8000

## 📁 Estrutura do Projeto

```
ssh-web-client/
├── bin/
│   └── server.php          # Bootstrap do servidor WebSocket
├── public/
│   ├── api/
│   │   └── connect.php     # API de conexão SSH
│   ├── css/
│   │   └── style.css       # Estilos da interface
│   ├── js/
│   │   └── app.js          # JavaScript do frontend
│   └── index.html          # Página principal
├── src/
│   └── WebSocket/
│       └── SSHServer.php   # Servidor WebSocket para SSH/SFTP
├── composer.json
├── start.bat               # Script de inicialização (Windows)
├── start.sh                # Script de inicialização (Linux/Mac)
└── README.md
```

## 🔧 Configuração

### Portas padrão

- **Servidor Web:** porta 8000
- **Servidor WebSocket:** porta 8080

Para alterar as portas, edite os arquivos `start.bat` ou `start.sh`.

## 🛡️ Segurança

⚠️ **Atenção:** Este projeto é destinado para uso em ambiente de desenvolvimento ou rede local. Para uso em produção, considere:

- Usar HTTPS com certificado SSL
- Implementar autenticação adicional
- Usar WSS (WebSocket Secure)
- Configurar firewall apropriadamente
- Não expor diretamente à internet

## 🔌 Tecnologias Utilizadas

### Backend
- **PHP 8.0+** - Linguagem principal
- **phpseclib** - Biblioteca para SSH/SFTP
- **Ratchet** - Servidor WebSocket

### Frontend
- **xterm.js** - Emulador de terminal
- **HTML5/CSS3** - Interface
- **JavaScript ES6+** - Lógica do cliente

## 📝 Como Usar

1. Acesse http://localhost:8000
2. Preencha os dados de conexão:
   - **Host:** IP ou domínio do servidor SSH
   - **Porta:** geralmente 22
   - **Usuário:** seu usuário SSH
   - **Senha:** sua senha
   - **Chave Privada:** (opcional) cole sua chave privada
3. Clique em **Conectar**
4. Use o terminal normalmente
5. Clique em **📁 SFTP** para gerenciar arquivos

## 🤝 Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues e pull requests.

## 📄 Licença

MIT License
