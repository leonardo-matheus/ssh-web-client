// Copie este arquivo para ecosystem.config.js e preencha suas credenciais
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
      AZURE_AI_API_KEY: 'YOUR_AZURE_AI_API_KEY_HERE',
      AZURE_AI_BASE_URL: 'https://YOUR_ENDPOINT.services.ai.azure.com/anthropic/v1'
    }
  }]
};
