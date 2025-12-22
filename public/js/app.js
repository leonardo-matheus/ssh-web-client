// SSH Web Client - Frontend Application

class SSHClient {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.socket = null;
        this.connected = false;
        this.connectionInfo = null;
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.setupKeyToggle();
    }

    bindEvents() {
        // Form submit
        document.getElementById('ssh-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.connect();
        });

        // Disconnect button
        document.getElementById('disconnect-btn').addEventListener('click', () => {
            this.disconnect();
        });

        // Fullscreen button
        document.getElementById('fullscreen-btn').addEventListener('click', () => {
            this.toggleFullscreen();
        });

        // SFTP button
        document.getElementById('sftp-btn').addEventListener('click', () => {
            this.openSFTP();
        });

        // Close SFTP
        document.getElementById('close-sftp').addEventListener('click', () => {
            this.closeSFTP();
        });

        // SFTP actions
        document.getElementById('go-path').addEventListener('click', () => {
            this.navigateTo(document.getElementById('current-path').value);
        });

        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.refreshFiles();
        });

        document.getElementById('upload-btn').addEventListener('click', () => {
            document.getElementById('file-upload').click();
        });

        document.getElementById('file-upload').addEventListener('change', (e) => {
            this.uploadFiles(e.target.files);
        });

        document.getElementById('new-folder-btn').addEventListener('click', () => {
            this.createNewFolder();
        });

        // Enter key on path input
        document.getElementById('current-path').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.navigateTo(e.target.value);
            }
        });

        // Window resize
        window.addEventListener('resize', () => {
            if (this.fitAddon && this.connected) {
                this.fitAddon.fit();
                this.sendResize();
            }
        });
    }

    setupKeyToggle() {
        const checkbox = document.getElementById('use-key');
        const keyGroup = document.getElementById('key-group');
        
        checkbox.addEventListener('change', () => {
            keyGroup.style.display = checkbox.checked ? 'block' : 'none';
        });
    }

    async connect() {
        const host = document.getElementById('host').value;
        const port = document.getElementById('port').value;
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const privateKey = document.getElementById('private-key').value;

        const btn = document.getElementById('connect-btn');
        const btnText = btn.querySelector('.btn-text');
        const btnLoading = btn.querySelector('.btn-loading');

        btn.disabled = true;
        btnText.style.display = 'none';
        btnLoading.style.display = 'inline';

        try {
            // Conectar via API
            const response = await fetch('api/connect.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    host,
                    port: parseInt(port),
                    username,
                    password,
                    private_key: privateKey || null
                })
            });

            const data = await response.json();

            if (data.success) {
                this.connectionInfo = { host, port, username };
                this.sessionId = data.session_id;
                this.showTerminal();
                this.initTerminal();
                this.connectWebSocket();
            } else {
                this.showError(data.error || 'Falha na conexão');
                btn.disabled = false;
                btnText.style.display = 'inline';
                btnLoading.style.display = 'none';
            }
        } catch (error) {
            this.showError('Erro ao conectar: ' + error.message);
            btn.disabled = false;
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
        }
    }

    initTerminal() {
        this.terminal = new Terminal({
            cursorBlink: true,
            cursorStyle: 'block',
            fontSize: 14,
            fontFamily: 'Consolas, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                cursorAccent: '#1e1e1e',
                selection: 'rgba(79, 172, 254, 0.3)',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#ffffff'
            }
        });

        this.fitAddon = new FitAddon.FitAddon();
        const webLinksAddon = new WebLinksAddon.WebLinksAddon();

        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(webLinksAddon);

        this.terminal.open(document.getElementById('terminal'));
        this.fitAddon.fit();

        this.terminal.onData((data) => {
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'input',
                    data: data
                }));
            }
        });

        this.terminal.onResize((size) => {
            this.sendResize();
        });
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.hostname}:8080`;

        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
            this.connected = true;
            // Enviar informações da sessão
            this.socket.send(JSON.stringify({
                type: 'auth',
                session_id: this.sessionId
            }));
            
            // Enviar tamanho do terminal
            setTimeout(() => {
                this.sendResize();
            }, 100);
        };

        this.socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            switch (message.type) {
                case 'output':
                    this.terminal.write(message.data);
                    break;
                case 'error':
                    this.showError(message.data);
                    break;
                case 'sftp':
                    this.handleSFTPResponse(message);
                    break;
                case 'disconnect':
                    this.handleDisconnect();
                    break;
            }
        };

        this.socket.onclose = () => {
            this.connected = false;
            if (this.terminal) {
                this.terminal.write('\r\n\x1b[31mConexão encerrada.\x1b[0m\r\n');
            }
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.showError('Erro na conexão WebSocket');
        };
    }

    sendResize() {
        if (this.socket && this.socket.readyState === WebSocket.OPEN && this.terminal) {
            this.socket.send(JSON.stringify({
                type: 'resize',
                cols: this.terminal.cols,
                rows: this.terminal.rows
            }));
        }
    }

    showTerminal() {
        document.getElementById('connection-form').style.display = 'none';
        document.getElementById('terminal-container').style.display = 'flex';
        document.getElementById('connection-info').textContent = 
            `${this.connectionInfo.username}@${this.connectionInfo.host}:${this.connectionInfo.port}`;
    }

    hideTerminal() {
        document.getElementById('connection-form').style.display = 'block';
        document.getElementById('terminal-container').style.display = 'none';
        
        const btn = document.getElementById('connect-btn');
        const btnText = btn.querySelector('.btn-text');
        const btnLoading = btn.querySelector('.btn-loading');
        
        btn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }

    disconnect() {
        if (this.socket) {
            this.socket.send(JSON.stringify({ type: 'disconnect' }));
            this.socket.close();
        }
        
        if (this.terminal) {
            this.terminal.dispose();
            this.terminal = null;
        }

        this.connected = false;
        this.hideTerminal();
        this.closeSFTP();
    }

    handleDisconnect() {
        if (this.terminal) {
            this.terminal.write('\r\n\x1b[33mSessão encerrada pelo servidor.\x1b[0m\r\n');
        }
        setTimeout(() => {
            this.disconnect();
        }, 2000);
    }

    toggleFullscreen() {
        const container = document.getElementById('terminal-container');
        container.classList.toggle('fullscreen');
        
        if (this.fitAddon) {
            setTimeout(() => {
                this.fitAddon.fit();
                this.sendResize();
            }, 100);
        }
    }

    // SFTP Functions
    openSFTP() {
        document.getElementById('sftp-panel').style.display = 'flex';
        this.navigateTo('/');
    }

    closeSFTP() {
        document.getElementById('sftp-panel').style.display = 'none';
    }

    navigateTo(path) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'sftp',
                action: 'list',
                path: path
            }));
        }
    }

    refreshFiles() {
        const currentPath = document.getElementById('current-path').value;
        this.navigateTo(currentPath);
    }

    handleSFTPResponse(message) {
        switch (message.action) {
            case 'list':
                this.renderFileList(message.data, message.path);
                break;
            case 'download':
                this.downloadFile(message.data, message.filename);
                break;
            case 'upload':
                if (message.success) {
                    this.refreshFiles();
                } else {
                    this.showError('Erro no upload: ' + message.error);
                }
                break;
            case 'delete':
                if (message.success) {
                    this.refreshFiles();
                } else {
                    this.showError('Erro ao deletar: ' + message.error);
                }
                break;
            case 'mkdir':
                if (message.success) {
                    this.refreshFiles();
                } else {
                    this.showError('Erro ao criar pasta: ' + message.error);
                }
                break;
        }
    }

    renderFileList(files, path) {
        document.getElementById('current-path').value = path;
        const fileList = document.getElementById('file-list');
        fileList.innerHTML = '';

        // Add parent directory if not root
        if (path !== '/') {
            const parentPath = path.split('/').slice(0, -1).join('/') || '/';
            const parentItem = this.createFileItem({
                name: '..',
                type: 'directory',
                size: 0,
                modified: ''
            }, parentPath);
            fileList.appendChild(parentItem);
        }

        // Sort: directories first, then files
        files.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
        });

        files.forEach(file => {
            const item = this.createFileItem(file, path);
            fileList.appendChild(item);
        });
    }

    createFileItem(file, currentPath) {
        const div = document.createElement('div');
        div.className = 'file-item';
        
        const icon = file.type === 'directory' ? '📁' : this.getFileIcon(file.name);
        const size = file.type === 'directory' ? '-' : this.formatSize(file.size);
        
        div.innerHTML = `
            <span class="icon">${icon}</span>
            <span class="name">${file.name}</span>
            <span class="size">${size}</span>
            <span class="date">${file.modified || ''}</span>
            <div class="actions">
                ${file.type !== 'directory' ? `<button class="action-btn download-btn" title="Download">⬇️</button>` : ''}
                ${file.name !== '..' ? `<button class="action-btn delete-btn danger" title="Deletar">🗑️</button>` : ''}
            </div>
        `;

        // Click to navigate or download
        div.addEventListener('dblclick', () => {
            if (file.type === 'directory') {
                const newPath = file.name === '..' 
                    ? currentPath 
                    : (currentPath === '/' ? '/' + file.name : currentPath + '/' + file.name);
                this.navigateTo(newPath);
            }
        });

        // Download button
        const downloadBtn = div.querySelector('.download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.downloadFileRequest(currentPath + '/' + file.name);
            });
        }

        // Delete button
        const deleteBtn = div.querySelector('.delete-btn');
        if (deleteBtn && file.name !== '..') {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Tem certeza que deseja deletar "${file.name}"?`)) {
                    this.deleteFile(currentPath + '/' + file.name, file.type === 'directory');
                }
            });
        }

        return div;
    }

    getFileIcon(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const icons = {
            'js': '📜', 'ts': '📜', 'py': '🐍', 'php': '🐘',
            'html': '🌐', 'css': '🎨', 'json': '📋', 'xml': '📋',
            'md': '📝', 'txt': '📄', 'log': '📄',
            'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
            'zip': '📦', 'tar': '📦', 'gz': '📦', 'rar': '📦',
            'pdf': '📕', 'doc': '📘', 'docx': '📘', 'xls': '📗', 'xlsx': '📗',
            'mp3': '🎵', 'wav': '🎵', 'mp4': '🎬', 'avi': '🎬',
            'sh': '⚙️', 'bat': '⚙️', 'exe': '⚙️'
        };
        return icons[ext] || '📄';
    }

    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    downloadFileRequest(path) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'sftp',
                action: 'download',
                path: path
            }));
        }
    }

    downloadFile(base64Data, filename) {
        const link = document.createElement('a');
        link.href = 'data:application/octet-stream;base64,' + base64Data;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    uploadFiles(files) {
        const currentPath = document.getElementById('current-path').value;
        
        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target.result.split(',')[1];
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({
                        type: 'sftp',
                        action: 'upload',
                        path: currentPath + '/' + file.name,
                        data: base64
                    }));
                }
            };
            reader.readAsDataURL(file);
        });
        
        // Clear input
        document.getElementById('file-upload').value = '';
    }

    deleteFile(path, isDirectory) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                type: 'sftp',
                action: 'delete',
                path: path,
                is_directory: isDirectory
            }));
        }
    }

    createNewFolder() {
        const folderName = prompt('Nome da nova pasta:');
        if (folderName) {
            const currentPath = document.getElementById('current-path').value;
            const newPath = (currentPath === '/' ? '/' : currentPath + '/') + folderName;
            
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'sftp',
                    action: 'mkdir',
                    path: newPath
                }));
            }
        }
    }

    showError(message) {
        // Remove existing alerts
        const existingAlerts = document.querySelectorAll('.alert');
        existingAlerts.forEach(a => a.remove());

        const alert = document.createElement('div');
        alert.className = 'alert error';
        alert.innerHTML = `<span>❌</span> ${message}`;
        
        const form = document.getElementById('ssh-form');
        form.insertBefore(alert, form.firstChild);
        
        setTimeout(() => {
            alert.remove();
        }, 5000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new SSHClient();
});
