// Carregar .env se existir
require('dotenv').config();

module.exports = {
  apps: [{
    name: 'ssh-web-client',
    script: 'server.js',
    cwd: '/var/www/ssh-web-client',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    // Carregar variáveis do .env automaticamente
    node_args: '-r dotenv/config',
    env: {
      NODE_ENV: 'production',
      PORT: 3022
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3022
    }
  }]
};