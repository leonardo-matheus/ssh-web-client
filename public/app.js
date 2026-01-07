// Socket.io connection
const socket = io({
    path: '/ssh/socket.io'
});

// Terminal setup
let term = null;
let fitAddon = null;
let isConnected = false;
let currentPath = '/';
let selectedFile = null;

// LocalStorage key
const STORAGE_KEY = 'ssh_credentials';

// Load saved credentials on page load
function loadSavedCredentials() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const credentials = JSON.parse(saved);
            document.getElementById('host').value = credentials.host || '';
            document.getElementById('port').value = credentials.port || 22;
            document.getElementById('username').value = credentials.username || '';
            document.getElementById('password').value = credentials.password || '';
            document.getElementById('privateKey').value = credentials.privateKey || '';
            document.getElementById('passphrase').value = credentials.passphrase || '';
            document.getElementById('rememberCredentials').checked = true;
            
            // Switch to correct auth tab if private key is saved
            if (credentials.privateKey) {
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.auth-content').forEach(c => c.classList.remove('active'));
                document.querySelector('[data-tab="privateKey"]').classList.add('active');
                document.getElementById('privateKeyAuth').classList.add('active');
            }
            
            showToast('Credenciais carregadas', 'info');
        }
    } catch (e) {
        console.error('Erro ao carregar credenciais:', e);
    }
}

// Save credentials to localStorage
function saveCredentials() {
    const credentials = {
        host: document.getElementById('host').value,
        port: document.getElementById('port').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        privateKey: document.getElementById('privateKey').value,
        passphrase: document.getElementById('passphrase').value
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
}

// Clear saved credentials
function clearSavedCredentials() {
    localStorage.removeItem(STORAGE_KEY);
    document.getElementById('host').value = '';
    document.getElementById('port').value = '22';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('privateKey').value = '';
    document.getElementById('passphrase').value = '';
    document.getElementById('rememberCredentials').checked = false;
    showToast('Credenciais removidas', 'success');
}

// DOM Elements
const connectionPanel = document.getElementById('connectionPanel');
const mainContent = document.getElementById('mainContent');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const connectionInfo = document.getElementById('connectionInfo');
const fileList = document.getElementById('fileList');
const currentPathInput = document.getElementById('currentPath');
const toastContainer = document.getElementById('toastContainer');
const headerSection = document.getElementById('headerSection');
const sftpPanel = document.querySelector('.sftp-panel');
const toggleSftpBtn = document.getElementById('toggleSftpBtn');
const hideSftpBtn = document.getElementById('hideSftpBtn');
const installAppBtn = document.getElementById('installAppBtn');

// Check if mobile
const isMobile = () => window.innerWidth <= 768;

// Auth tabs
document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.auth-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + 'Auth').classList.add('active');
    });
});

// Initialize terminal
function initTerminal() {
    if (term) {
        term.dispose();
    }

    term = new Terminal({
        cursorBlink: true,
        fontFamily: '"Cascadia Code", "Fira Code", "Source Code Pro", monospace',
        fontSize: 14,
        theme: {
            background: '#0d1117',
            foreground: '#c9d1d9',
            cursor: '#58a6ff',
            cursorAccent: '#0d1117',
            selection: 'rgba(56, 139, 253, 0.4)',
            black: '#484f58',
            red: '#ff7b72',
            green: '#3fb950',
            yellow: '#d29922',
            blue: '#58a6ff',
            magenta: '#bc8cff',
            cyan: '#39c5cf',
            white: '#b1bac4',
            brightBlack: '#6e7681',
            brightRed: '#ffa198',
            brightGreen: '#56d364',
            brightYellow: '#e3b341',
            brightBlue: '#79c0ff',
            brightMagenta: '#d2a8ff',
            brightCyan: '#56d4dd',
            brightWhite: '#f0f6fc'
        }
    });

    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    term.onData(data => {
        if (isConnected) {
            socket.emit('ssh-data', data);
        }
    });

    // Handle resize
    window.addEventListener('resize', () => {
        if (fitAddon) {
            fitAddon.fit();
            if (isConnected) {
                socket.emit('ssh-resize', {
                    cols: term.cols,
                    rows: term.rows
                });
            }
        }
    });
}

// Connect button handler
connectBtn.addEventListener('click', () => {
    const host = document.getElementById('host').value;
    const port = document.getElementById('port').value || 22;
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const privateKey = document.getElementById('privateKey').value;
    const passphrase = document.getElementById('passphrase').value;

    if (!host || !username) {
        showToast('Preencha host e usuário', 'error');
        return;
    }

    const config = {
        host,
        port: parseInt(port),
        username
    };

    if (privateKey) {
        config.privateKey = privateKey;
        if (passphrase) {
            config.passphrase = passphrase;
        }
    } else {
        config.password = password;
    }

    connectBtn.disabled = true;
    connectBtn.innerHTML = '<span class="loading"></span> Conectando...';

    // Save credentials if checkbox is checked
    if (document.getElementById('rememberCredentials').checked) {
        saveCredentials();
    }

    initTerminal();
    socket.emit('ssh-connect', config);

    connectionInfo.textContent = `${username}@${host}:${port}`;
});

// Disconnect button handler
disconnectBtn.addEventListener('click', () => {
    socket.disconnect();
    socket.connect();
    disconnect();
});

function disconnect() {
    isConnected = false;
    statusDot.classList.remove('connected');
    statusText.textContent = 'Desconectado';
    connectionPanel.style.display = 'block';
    headerSection.classList.remove('hidden');
    mainContent.classList.remove('active');
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<i class="fas fa-plug"></i> Conectar';
    selectedFile = null;
}

// Socket events
socket.on('ssh-ready', () => {
    isConnected = true;
    statusDot.classList.add('connected');
    statusText.textContent = 'Conectado';
    connectionPanel.style.display = 'none';
    headerSection.classList.add('hidden');
    mainContent.classList.add('active');
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<i class="fas fa-plug"></i> Conectar';
    showToast('Conectado com sucesso!', 'success');

    // Load initial directory
    setTimeout(() => {
        fitAddon.fit();
        socket.emit('ssh-resize', {
            cols: term.cols,
            rows: term.rows
        });
    }, 100);

    loadDirectory('/');
});

socket.on('ssh-data', (data) => {
    if (term) {
        term.write(data);
    }
});

socket.on('ssh-error', (error) => {
    showToast('Erro: ' + error, 'error');
    connectBtn.disabled = false;
    connectBtn.innerHTML = '<i class="fas fa-plug"></i> Conectar';
});

socket.on('ssh-close', () => {
    showToast('Conexão fechada', 'info');
    disconnect();
});

// SFTP Functions
function loadDirectory(path) {
    currentPath = path;
    currentPathInput.value = path;
    fileList.innerHTML = '<div style="padding: 20px; text-align: center;"><span class="loading"></span></div>';
    socket.emit('sftp-list', path);
}

socket.on('sftp-list', (data) => {
    currentPath = data.path;
    currentPathInput.value = data.path;
    
    // Sort: directories first, then files, alphabetically
    const files = data.files.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
    });

    fileList.innerHTML = '';

    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.name = file.name;
        item.dataset.type = file.type;

        const icon = file.type === 'directory' 
            ? '<i class="fas fa-folder folder-icon"></i>'
            : getFileIcon(file.name);

        const size = file.type === 'directory' ? '-' : formatSize(file.size);
        const date = new Date(file.modified).toLocaleString('pt-BR');

        item.innerHTML = `
            ${icon}
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">${size} • ${date}</div>
            </div>
        `;

        item.addEventListener('click', (e) => {
            document.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            selectedFile = file;
        });

        item.addEventListener('dblclick', () => {
            if (file.type === 'directory') {
                const newPath = currentPath === '/' 
                    ? '/' + file.name 
                    : currentPath + '/' + file.name;
                loadDirectory(newPath);
            }
        });

        fileList.appendChild(item);
    });
});

socket.on('sftp-error', (error) => {
    showToast('SFTP Erro: ' + error, 'error');
});

socket.on('sftp-success', (message) => {
    showToast(message, 'success');
    loadDirectory(currentPath);
});

socket.on('sftp-download', ({ fileName, data }) => {
    const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Download concluído: ' + fileName, 'success');
});

// SFTP Buttons
document.getElementById('refreshBtn').addEventListener('click', () => {
    loadDirectory(currentPath);
});

document.getElementById('parentDirBtn').addEventListener('click', () => {
    if (currentPath !== '/') {
        const parts = currentPath.split('/').filter(p => p);
        parts.pop();
        const newPath = '/' + parts.join('/');
        loadDirectory(newPath || '/');
    }
});

document.getElementById('goPathBtn').addEventListener('click', () => {
    loadDirectory(currentPathInput.value || '/');
});

currentPathInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        loadDirectory(currentPathInput.value || '/');
    }
});

// New Folder
const newFolderModal = document.getElementById('newFolderModal');
document.getElementById('newFolderBtn').addEventListener('click', () => {
    document.getElementById('folderName').value = '';
    newFolderModal.classList.add('active');
});

document.getElementById('cancelFolderBtn').addEventListener('click', () => {
    newFolderModal.classList.remove('active');
});

document.getElementById('createFolderBtn').addEventListener('click', () => {
    const name = document.getElementById('folderName').value;
    if (name) {
        const newPath = currentPath === '/' 
            ? '/' + name 
            : currentPath + '/' + name;
        socket.emit('sftp-mkdir', newPath);
        newFolderModal.classList.remove('active');
    }
});

// Delete
const deleteModal = document.getElementById('deleteModal');
document.getElementById('deleteBtn').addEventListener('click', () => {
    if (!selectedFile) {
        showToast('Selecione um arquivo ou pasta', 'error');
        return;
    }
    document.getElementById('deleteMessage').textContent = 
        `Tem certeza que deseja excluir "${selectedFile.name}"?`;
    deleteModal.classList.add('active');
});

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    deleteModal.classList.remove('active');
});

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    if (selectedFile) {
        const path = currentPath === '/' 
            ? '/' + selectedFile.name 
            : currentPath + '/' + selectedFile.name;
        socket.emit('sftp-delete', { 
            path, 
            isDirectory: selectedFile.type === 'directory' 
        });
        deleteModal.classList.remove('active');
        selectedFile = null;
    }
});

// Upload
document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', (e) => {
    const files = e.target.files;
    for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = btoa(
                new Uint8Array(reader.result)
                    .reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            socket.emit('sftp-upload', {
                remotePath: currentPath,
                fileName: file.name,
                data: base64
            });
        };
        reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
});

// Download
document.getElementById('downloadBtn').addEventListener('click', () => {
    if (!selectedFile || selectedFile.type === 'directory') {
        showToast('Selecione um arquivo para download', 'error');
        return;
    }
    const path = currentPath === '/' 
        ? '/' + selectedFile.name 
        : currentPath + '/' + selectedFile.name;
    socket.emit('sftp-download', path);
});

// Toggle SFTP Panel
function toggleSftp() {
    mainContent.classList.toggle('sftp-visible');
    const icon = toggleSftpBtn.querySelector('i');
    if (mainContent.classList.contains('sftp-visible')) {
        icon.className = 'fas fa-folder-open';
    } else {
        icon.className = 'fas fa-folder';
    }
    setTimeout(() => fitAddon && fitAddon.fit(), 100);
}

toggleSftpBtn.addEventListener('click', toggleSftp);
hideSftpBtn.addEventListener('click', toggleSftp);

// Fullscreen
document.getElementById('fullscreenBtn').addEventListener('click', () => {
    mainContent.classList.toggle('fullscreen');
    const icon = document.querySelector('#fullscreenBtn i');
    if (mainContent.classList.contains('fullscreen')) {
        icon.className = 'fas fa-compress';
    } else {
        icon.className = 'fas fa-expand';
    }
    setTimeout(() => fitAddon && fitAddon.fit(), 100);
});

// Utility functions
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${message}`;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        'js': 'fab fa-js-square" style="color: #f7df1e',
        'ts': 'fab fa-js-square" style="color: #3178c6',
        'py': 'fab fa-python" style="color: #3776ab',
        'html': 'fab fa-html5" style="color: #e34f26',
        'css': 'fab fa-css3-alt" style="color: #1572b6',
        'json': 'fas fa-code" style="color: #f7df1e',
        'md': 'fab fa-markdown" style="color: #083fa1',
        'txt': 'fas fa-file-alt" style="color: #8892b0',
        'pdf': 'fas fa-file-pdf" style="color: #ff0000',
        'zip': 'fas fa-file-archive" style="color: #f0ad4e',
        'tar': 'fas fa-file-archive" style="color: #f0ad4e',
        'gz': 'fas fa-file-archive" style="color: #f0ad4e',
        'jpg': 'fas fa-file-image" style="color: #8892b0',
        'jpeg': 'fas fa-file-image" style="color: #8892b0',
        'png': 'fas fa-file-image" style="color: #8892b0',
        'gif': 'fas fa-file-image" style="color: #8892b0',
        'svg': 'fas fa-file-image" style="color: #8892b0',
        'sh': 'fas fa-terminal" style="color: #4eaa25',
        'bash': 'fas fa-terminal" style="color: #4eaa25',
        'yml': 'fas fa-file-code" style="color: #cb171e',
        'yaml': 'fas fa-file-code" style="color: #cb171e',
        'xml': 'fas fa-file-code" style="color: #f16529',
        'sql': 'fas fa-database" style="color: #336791',
        'env': 'fas fa-cog" style="color: #8892b0',
        'log': 'fas fa-file-alt" style="color: #8892b0',
    };

    const icon = iconMap[ext] || 'fas fa-file file-icon';
    return `<i class="${icon}"></i>`;
}

// Close modals on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    }
});

// Clear credentials button
document.getElementById('clearCredentialsBtn').addEventListener('click', clearSavedCredentials);

// Load saved credentials on page load
document.addEventListener('DOMContentLoaded', loadSavedCredentials);

// PWA Install - expose deferredPrompt globally
window.deferredPromptGlobal = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.deferredPromptGlobal = e;
    // Show install button in header
    if (installAppBtn) {
        installAppBtn.style.display = 'inline-flex';
    }
});

if (installAppBtn) {
    installAppBtn.addEventListener('click', async () => {
        if (!window.deferredPromptGlobal) {
            showToast('App já instalado ou não disponível', 'info');
            return;
        }
        
        window.deferredPromptGlobal.prompt();
        const { outcome } = await window.deferredPromptGlobal.userChoice;
        
        if (outcome === 'accepted') {
            showToast('App instalado com sucesso!', 'success');
        }
        
        window.deferredPromptGlobal = null;
        installAppBtn.style.display = 'none';
    });
}

window.addEventListener('appinstalled', () => {
    if (installAppBtn) {
        installAppBtn.style.display = 'none';
    }
    window.deferredPromptGlobal = null;
});
