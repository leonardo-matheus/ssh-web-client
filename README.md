# 🖥️ SSH Web Client

Um cliente SSH e SFTP baseado em web, similar ao [ssheasy.com](https://ssheasy.com/).

## ✨ Funcionalidades

- 🔐 Conexão SSH via navegador
- 📁 Gerenciador de arquivos SFTP integrado
- ⌨️ Terminal interativo com xterm.js
- 🔑 Suporte a autenticação por senha ou chave privada
- 📤 Upload e download de arquivos
- 🗂️ Criar/deletar pastas e arquivos
- 🖥️ Modo tela cheia
- 🎨 Interface moderna e responsiva

## 🚀 Instalação Local

```bash
# Instalar dependências
npm install

# Rodar em desenvolvimento
npm run dev

# Rodar em produção
npm start
```

Acesse: http://localhost:3022/ssh

## 📦 Deploy na VPS

### 1. Clonar e Instalar

```bash
# Na VPS, clone o repositório
cd /var/www
git clone <seu-repo> ssh-web-client
cd ssh-web-client

# Instalar dependências
npm install --production

# Criar pasta de uploads
mkdir -p uploads
```

### 2. Configurar PM2

```bash
# Instalar PM2 globalmente (se ainda não tiver)
sudo npm install -g pm2

# Iniciar a aplicação
pm2 start ecosystem.config.js

# Configurar para iniciar com o sistema
pm2 save
pm2 startup
```

### 3. Configurar Nginx

Adicione esta configuração no seu arquivo nginx:

```nginx
# SSH Web Client (Node.js on port 3022)
location /ssh {
    proxy_pass http://127.0.0.1:3022;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}

# Socket.io para SSH Web Client
location /ssh/socket.io {
    proxy_pass http://127.0.0.1:3022;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

### 4. Reiniciar Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 🔧 Comandos Úteis

```bash
# Ver status do PM2
pm2 status

# Ver logs
pm2 logs ssh-web-client

# Reiniciar aplicação
pm2 restart ssh-web-client

# Parar aplicação
pm2 stop ssh-web-client
```

## 📝 Licença

MIT

