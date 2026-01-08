module.exports = {
  apps: [{
    name: 'ssh-web-client',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3022,
      // Azure AI Foundry - Claude API Configuration
      // Estas variáveis podem ser sobrescritas por variáveis de ambiente do sistema
      AZURE_AI_API_KEY: process.env.AZURE_AI_API_KEY || '',
      AZURE_AI_BASE_URL: process.env.AZURE_AI_BASE_URL || 'https://conta-ma6t6uyn-eastus2.services.ai.azure.com/anthropic/v1'
    }
  }]
};
