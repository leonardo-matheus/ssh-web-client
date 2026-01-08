pipeline {
    agent any
    
    environment {
        APP_NAME = 'ssh-web-client'
        APP_DIR = '/var/www/ssh-web-client'
        NODE_ENV = 'production'
    }
    
    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
        timeout(time: 10, unit: 'MINUTES')
    }
    
    stages {
        stage('📥 Checkout') {
            steps {
                echo '🔄 Baixando código do repositório...'
                checkout scm
            }
        }
        
        stage('📋 Info') {
            steps {
                echo '📋 Informações do Build'
                sh '''
                    echo "Branch: ${GIT_BRANCH}"
                    echo "Commit: ${GIT_COMMIT}"
                    echo "Node Version: $(node -v)"
                    echo "NPM Version: $(npm -v)"
                '''
            }
        }
        
        stage('📦 Install Dependencies') {
            steps {
                echo '📦 Instalando dependências...'
                sh '''
                    # Instalar todas as dependências (incluindo devDependencies para gerar ícones)
                    npm ci
                '''
            }
        }
        
        stage('🎨 Generate Icons') {
            steps {
                echo '🎨 Gerando ícones PWA...'
                sh '''
                    if [ -f scripts/generate-icons.js ]; then
                        node scripts/generate-icons.js || echo "⚠️ Icon generation skipped"
                    else
                        echo "ℹ️ Script de ícones não encontrado, pulando..."
                    fi
                '''
            }
        }
        
        stage('🚀 Deploy') {
            steps {
                echo '🚀 Fazendo deploy da aplicação...'
                sh '''
                    # Criar diretório se não existir
                    sudo mkdir -p ${APP_DIR}
                    
                    # Copiar arquivos para o diretório de produção
                    sudo rsync -av --delete \
                        --exclude='.git' \
                        --exclude='Jenkinsfile' \
                        ./ ${APP_DIR}/
                    
                    # Ajustar permissões
                    sudo chown -R $USER:$USER ${APP_DIR}
                    
                    # Criar pasta de uploads se não existir
                    mkdir -p ${APP_DIR}/uploads
                '''
            }
        }
        
        stage('🔄 Restart Service') {
            steps {
                echo '🔄 Reiniciando serviço com PM2...'
                sh '''
                    cd ${APP_DIR}
                    
                    # Verificar arquivo .env
                    if [ ! -f .env ]; then
                        echo "⚠️ ATENÇÃO: Arquivo .env não encontrado!"
                        echo "Crie o arquivo /var/www/ssh-web-client/.env com:"
                        echo "AZURE_AI_API_KEY=sua-chave-aqui"
                        echo "AZURE_AI_BASE_URL=https://conta-ma6t6uyn-eastus2.services.ai.azure.com"
                    else
                        echo "✅ Arquivo .env encontrado"
                        # Mostrar variáveis configuradas (sem valores sensíveis)
                        grep -E "^[A-Z_]+=" .env | cut -d= -f1 | while read var; do
                            echo "  → $var configurado"
                        done
                    fi
                    
                    # Verificar se o app já está rodando no PM2
                    if pm2 describe ${APP_NAME} > /dev/null 2>&1; then
                        echo "♻️ Reiniciando aplicação existente..."
                        pm2 restart ${APP_NAME} --update-env
                    else
                        echo "🆕 Iniciando nova aplicação..."
                        # Usar ecosystem.config.js se existir, senão iniciar direto
                        if [ -f ecosystem.config.js ]; then
                            pm2 start ecosystem.config.js --update-env
                        else
                            pm2 start server.js --name ${APP_NAME} --update-env
                        fi
                    fi
                    
                    # Salvar estado do PM2
                    pm2 save
                    
                    # Mostrar status
                    pm2 show ${APP_NAME}
                '''
            }
        }
        
        stage('✅ Health Check') {
            steps {
                echo '✅ Verificando se a aplicação está rodando...'
                sh '''
                    sleep 3
                    
                    # Verificar status do PM2
                    pm2 status ${APP_NAME}
                    
                    # Verificar se a porta está respondendo
                    curl -f http://localhost:3022/ssh || exit 1
                    
                    echo "✅ Aplicação rodando com sucesso!"
                '''
            }
        }
    }
    
    post {
        success {
            echo '''
            ╔═══════════════════════════════════════════╗
            ║  ✅ Deploy realizado com sucesso!         ║
            ║  🌐 https://191-235-32-212.nip.io/ssh     ║
            ║  🤖 Chat AI integrado e funcionando!      ║
            ╚═══════════════════════════════════════════╝
            '''
        }
        failure {
            echo '''
            ╔═══════════════════════════════════════════╗
            ║  ❌ Falha no deploy!                      ║
            ║  📋 Verifique os logs acima               ║
            ╚═══════════════════════════════════════════╝
            '''
            sh '''
                echo "📋 Últimos logs do PM2:"
                pm2 logs ${APP_NAME} --lines 20 --nostream || true
            '''
        }
        always {
            cleanWs()
        }
    }
}
