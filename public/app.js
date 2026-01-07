// Socket.io connection
const socket = io({
    path: '/ssh/socket.io'
});

// Test socket connection
socket.on('connect', () => {
    console.log('Socket connected, testing...');
    socket.emit('ping-test', (response) => {
        console.log('Ping response:', response);
    });
});

// Terminal setup
let term = null;
let fitAddon = null;
let isConnected = false;
let currentPath = '/';
let selectedFile = null;
let selectedFiles = []; // Array para múltipla seleção
let lastSelectedIndex = -1; // Para seleção com Shift
let copyMoveOperation = null; // 'copy' ou 'move'
let clipboard = { files: [], operation: null }; // Para Ctrl+C/X/V

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
// Check if mobile
const isMobile = () => window.innerWidth <= 768;

// Monaco Editor
let monacoEditor = null;
let currentEditingFile = null;
let pendingFileContent = null;
let monacoReady = false;
let fileLoadTimeout = null;

// Language mapping
const languageMap = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'scss',
    'sass': 'scss',
    'less': 'less',
    'json': 'json',
    'xml': 'xml',
    'md': 'markdown',
    'markdown': 'markdown',
    'php': 'php',
    'py': 'python',
    'python': 'python',
    'rb': 'ruby',
    'java': 'java',
    'kt': 'kotlin',
    'kotlin': 'kotlin',
    'rs': 'rust',
    'rust': 'rust',
    'go': 'go',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'swift': 'swift',
    'sql': 'sql',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'ps1': 'powershell',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'ini',
    'ini': 'ini',
    'conf': 'ini',
    'dockerfile': 'dockerfile',
    'docker': 'dockerfile',
    'vue': 'html',
    'svelte': 'html'
};

function getLanguageFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return languageMap[ext] || 'plaintext';
}

// Initialize Monaco Editor
function initMonaco(callback) {
    if (monacoReady && monacoEditor) {
        callback();
        return;
    }

    monacoRequire(['vs/editor/editor.main'], function () {
        monacoEditor = monaco.editor.create(document.getElementById('monacoEditor'), {
            value: '',
            language: 'plaintext',
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 14,
            fontFamily: '"Cascadia Code", "Fira Code", "Source Code Pro", monospace',
            minimap: { enabled: window.innerWidth > 768 },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 2,
            insertSpaces: true,
            formatOnPaste: true,
            formatOnType: true
        });

        // Keyboard shortcut to save
        monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function () {
            saveCurrentFile();
        });

        monacoReady = true;
        callback();
    });
}

function showEditorLoading(show, message = 'Carregando arquivo...') {
    const loading = document.getElementById('editorLoading');
    const loadingText = loading.querySelector('p');
    loadingText.textContent = message;
    if (show) {
        loading.classList.add('show');
    } else {
        loading.classList.remove('show');
    }
}

function loadContentIntoEditor(content) {
    if (!monacoEditor || !currentEditingFile) return;
    
    // Clear timeout
    if (fileLoadTimeout) {
        clearTimeout(fileLoadTimeout);
        fileLoadTimeout = null;
    }
    
    const editorStatus = document.getElementById('editorStatus');
    const editorLanguage = document.getElementById('editorLanguage');
    const language = getLanguageFromFilename(currentEditingFile.name);
    
    console.log('Setting editor content, language:', language);
    
    editorLanguage.textContent = language;
    monaco.editor.setModelLanguage(monacoEditor.getModel(), language);
    monacoEditor.setValue(content);
    monacoEditor.focus();
    editorStatus.textContent = 'Pronto';
    showEditorLoading(false);
}

function openFileInEditor(filePath, fileName) {
    const editorModal = document.getElementById('editorModal');
    const editorFileName = document.getElementById('editorFileName');
    const editorStatus = document.getElementById('editorStatus');

    console.log('Opening file:', filePath);
    
    editorFileName.textContent = fileName;
    editorStatus.textContent = 'Carregando...';
    editorModal.classList.add('active');
    showEditorLoading(true, 'Baixando arquivo...');

    currentEditingFile = { path: filePath, name: fileName };
    pendingFileContent = null;
    
    // Clear any existing timeout
    if (fileLoadTimeout) {
        clearTimeout(fileLoadTimeout);
    }
    
    // Set timeout for loading
    fileLoadTimeout = setTimeout(() => {
        if (document.getElementById('editorLoading').classList.contains('show')) {
            console.log('File load timeout');
            showEditorLoading(false);
            showToast('Timeout ao carregar arquivo. Tente novamente.', 'error');
            closeEditor();
        }
    }, 30000); // 30 second timeout

    // Request file content immediately
    console.log('Requesting file content for:', filePath);
    console.log('Socket connected:', socket.connected);
    console.log('Socket id:', socket.id);
    
    if (!socket.connected) {
        showToast('Socket desconectado. Reconectando...', 'error');
        showEditorLoading(false);
        closeEditor();
        return;
    }
    
    // Use callback to confirm server received the event
    socket.emit('sftp-read-file', filePath, (response) => {
        console.log('Server response:', response);
        if (response && response.error) {
            showEditorLoading(false);
            showToast('Erro: ' + response.error, 'error');
            closeEditor();
        }
    });
    
    // Also try with timeout to emit again if no response
    setTimeout(() => {
        if (document.getElementById('editorLoading').classList.contains('show') && pendingFileContent === null) {
            console.log('No response yet, checking connection...');
        }
    }, 3000);

    // Initialize Monaco
    initMonaco(() => {
        console.log('Monaco ready');
        // Clear previous content
        monacoEditor.setValue('// Carregando...');
        
        // If content already arrived, load it
        if (pendingFileContent !== null) {
            console.log('Loading pending content');
            loadContentIntoEditor(pendingFileContent);
            pendingFileContent = null;
        }
    });
}

function saveCurrentFile() {
    if (!currentEditingFile || !monacoEditor) return;

    const content = monacoEditor.getValue();
    const editorStatus = document.getElementById('editorStatus');
    editorStatus.textContent = 'Salvando...';
    showEditorLoading(true, 'Salvando arquivo...');

    socket.emit('sftp-write-file', {
        path: currentEditingFile.path,
        content: content
    });
}

function closeEditor() {
    const editorModal = document.getElementById('editorModal');
    editorModal.classList.remove('active');
    currentEditingFile = null;
}

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

    // Handle ESC to exit fullscreen (even when terminal is focused)
    term.attachCustomKeyEventHandler((event) => {
        if (event.key === 'Escape' && document.body.classList.contains('fullscreen-mode')) {
            toggleFullscreen();
            return false; // Prevent default
        }
        return true; // Allow other keys
    });

    // Handle resize with debounce
    let resizeTimeout;
    const handleResize = () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (fitAddon && term) {
                fitAddon.fit();
                if (isConnected) {
                    socket.emit('ssh-resize', {
                        cols: term.cols,
                        rows: term.rows
                    });
                }
            }
        }, 100);
    };

    window.addEventListener('resize', handleResize);
    
    // Also observe terminal container size changes
    const terminalContainer = document.getElementById('terminal');
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(terminalContainer);
    }
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
    document.body.classList.remove('connected');
    document.body.classList.remove('fullscreen-mode');
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
    document.body.classList.add('connected');
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

    files.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.name = file.name;
        item.dataset.type = file.type;
        item.dataset.index = index;

        const icon = file.type === 'directory' 
            ? '<i class="fas fa-folder folder-icon"></i>'
            : getFileIcon(file.name);

        const size = file.type === 'directory' ? '-' : formatSize(file.size);
        const date = new Date(file.modified).toLocaleString('pt-BR');

        item.innerHTML = `
            <div class="file-checkbox" data-index="${index}"></div>
            ${icon}
            <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">${size} • ${date}</div>
            </div>
        `;

        // Checkbox click
        const checkbox = item.querySelector('.file-checkbox');
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFileSelection(file, index, e.shiftKey);
        });

        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('file-checkbox')) return;
            
            // Se já está em modo seleção, permite Ctrl/Shift
            if (selectedFiles.length > 0) {
                if (e.ctrlKey || e.metaKey) {
                    toggleFileSelection(file, index, false);
                } else if (e.shiftKey) {
                    toggleFileSelection(file, index, true);
                } else {
                    // Clique simples em modo seleção - seleciona apenas este
                    clearFileSelection();
                    selectedFile = file;
                    item.classList.add('selected');
                }
            } else {
                // Seleção simples (sem modo seleção) - apenas destaca
                document.querySelectorAll('.file-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                selectedFile = file;
            }
        });

        item.addEventListener('dblclick', () => {
            const fullPath = currentPath === '/' 
                ? '/' + file.name 
                : currentPath + '/' + file.name;
                
            if (file.type === 'directory') {
                loadDirectory(fullPath);
            } else {
                // Open file in editor
                openFileInEditor(fullPath, file.name);
            }
        });

        // Context menu (right click)
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Se o item não está selecionado, seleciona ele
            if (!selectedFiles.find(f => f.name === file.name)) {
                clearFileSelection();
                selectFile(file, index);
            }
            showContextMenu(e.clientX, e.clientY);
        });

        fileList.appendChild(item);
    });

    // Armazenar files para referência
    fileList.dataset.files = JSON.stringify(files);
});

socket.on('sftp-error', (error) => {
    showToast('SFTP Erro: ' + error, 'error');
});

// ========== FILE SELECTION ==========

function selectFile(file, index) {
    selectedFiles.push(file);
    selectedFile = file;
    lastSelectedIndex = index;
    updateFileSelectionUI();
}

function toggleFileSelection(file, index, useShift) {
    const fileList = document.getElementById('fileList');
    const files = JSON.parse(fileList.dataset.files || '[]');
    
    if (useShift && lastSelectedIndex !== -1) {
        // Seleção em massa com Shift
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        
        for (let i = start; i <= end; i++) {
            const f = files[i];
            if (!selectedFiles.find(sf => sf.name === f.name)) {
                selectedFiles.push(f);
            }
        }
    } else {
        // Toggle individual
        const existingIndex = selectedFiles.findIndex(f => f.name === file.name);
        if (existingIndex > -1) {
            selectedFiles.splice(existingIndex, 1);
        } else {
            selectedFiles.push(file);
        }
        lastSelectedIndex = index;
    }
    
    selectedFile = selectedFiles.length > 0 ? selectedFiles[selectedFiles.length - 1] : null;
    updateFileSelectionUI();
}

function clearFileSelection() {
    selectedFiles = [];
    selectedFile = null;
    lastSelectedIndex = -1;
    updateFileSelectionUI();
}

function updateFileSelectionUI() {
    const fileList = document.getElementById('fileList');
    const items = fileList.querySelectorAll('.file-item');
    const selectionBar = document.getElementById('selectionBar');
    const selectionCount = document.getElementById('selectionCount');
    const selectAllRow = document.getElementById('selectAllRow');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const sftpPanel = document.querySelector('.sftp-panel');
    const deleteBtn = document.getElementById('deleteBtn');
    const files = JSON.parse(fileList.dataset.files || '[]');
    
    // Toggle selection mode class
    if (selectedFiles.length > 0) {
        fileList.classList.add('selection-mode');
        selectionBar.classList.add('show');
        selectionCount.textContent = selectedFiles.length;
        sftpPanel.classList.add('selection-active');
        deleteBtn.style.display = 'inline-flex';
        
        // Check if all selected
        if (selectedFiles.length === files.length) {
            selectAllCheckbox.classList.add('checked');
        } else {
            selectAllCheckbox.classList.remove('checked');
        }
    } else {
        fileList.classList.remove('selection-mode');
        selectionBar.classList.remove('show');
        sftpPanel.classList.remove('selection-active');
        selectAllCheckbox.classList.remove('checked');
        deleteBtn.style.display = 'none';
    }
    
    items.forEach(item => {
        const fileName = item.dataset.name;
        const checkbox = item.querySelector('.file-checkbox');
        const isSelected = selectedFiles.find(f => f.name === fileName);
        
        if (isSelected) {
            item.classList.add('selected');
            checkbox.classList.add('checked');
        } else {
            item.classList.remove('selected');
            checkbox.classList.remove('checked');
        }
    });
}

// Selecionar todos os arquivos
function selectAllFiles() {
    const fileList = document.getElementById('fileList');
    const files = JSON.parse(fileList.dataset.files || '[]');
    
    if (selectedFiles.length === files.length) {
        // Se todos selecionados, deseleciona
        clearFileSelection();
    } else {
        // Seleciona todos
        selectedFiles = [...files];
        selectedFile = files.length > 0 ? files[files.length - 1] : null;
        lastSelectedIndex = files.length - 1;
        updateFileSelectionUI();
    }
}

// Event listeners para botões
document.getElementById('selectAllRow').addEventListener('click', selectAllFiles);
document.getElementById('clearSelectionBtn').addEventListener('click', () => {
    clearFileSelection();
});

// ========== KEYBOARD SHORTCUTS (Ctrl+A, C, X, V) ==========

function copyToClipboard(cut = false) {
    if (selectedFiles.length === 0) {
        showToast('Selecione arquivos primeiro', 'error');
        return;
    }
    
    clipboard.files = selectedFiles.map(f => {
        return currentPath === '/' ? '/' + f.name : currentPath + '/' + f.name;
    });
    clipboard.sourcePath = currentPath;
    clipboard.operation = cut ? 'cut' : 'copy';
    
    console.log('Clipboard:', clipboard);
    showToast(`${selectedFiles.length} item(ns) ${cut ? 'recortado(s)' : 'copiado(s)'}`, 'success');
}

function pasteFromClipboard() {
    if (!clipboard.files || clipboard.files.length === 0) {
        showToast('Nada para colar', 'error');
        return;
    }
    
    console.log('Pasting:', clipboard);
    const operation = clipboard.operation === 'cut' ? 'move' : 'copy';
    
    executeCopyMove(operation, clipboard.files, currentPath);
    
    // Limpar clipboard se foi recortar
    if (clipboard.operation === 'cut') {
        clipboard = { files: [], operation: null, sourcePath: null };
    }
}

function executeCopyMove(operation, files, destination) {
    console.log('Execute copy/move:', operation, files, 'to:', destination);
    
    socket.emit('sftp-copy-move', {
        operation: operation,
        files: files,
        destination: destination
    }, (response) => {
        console.log('Copy/move response:', response);
        if (response && response.error) {
            showToast('Erro: ' + response.error, 'error');
        } else {
            showToast(`${operation === 'copy' ? 'Copiado' : 'Movido'} com sucesso!`, 'success');
            loadDirectory(currentPath);
            clearFileSelection();
        }
});
    
    showToast(`${operation === 'copy' ? 'Copiando' : 'Movendo'} ${files.length} item(ns)...`, 'info');
}

// ========== CONTEXT MENU ==========

const contextMenu = document.getElementById('contextMenu');

function showContextMenu(x, y) {
    // Ajustar posição para não sair da tela
    const menuWidth = 180;
    const menuHeight = 250;
    
    if (x + menuWidth > window.innerWidth) {
        x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
        y = window.innerHeight - menuHeight - 10;
    }
    
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    contextMenu.classList.add('show');
    
    // Habilitar/desabilitar opções baseado na seleção
    const hasZipSelected = selectedFiles.some(f => 
        f.name.endsWith('.zip') || f.name.endsWith('.tar') || 
        f.name.endsWith('.gz') || f.name.endsWith('.tar.gz')
    );
    document.getElementById('ctxExtract').style.display = hasZipSelected ? 'flex' : 'none';
}

function hideContextMenu() {
    contextMenu.classList.remove('show');
}

// Fechar context menu ao clicar fora
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

// Context menu actions
document.getElementById('ctxCopy').addEventListener('click', () => {
    hideContextMenu();
    openCopyMoveModal('copy');
});

document.getElementById('ctxMove').addEventListener('click', () => {
    hideContextMenu();
    openCopyMoveModal('move');
});

document.getElementById('ctxCompress').addEventListener('click', () => {
    hideContextMenu();
    openCompressModal();
});

document.getElementById('ctxExtract').addEventListener('click', () => {
    hideContextMenu();
    extractFiles();
});

document.getElementById('ctxDownload').addEventListener('click', () => {
    hideContextMenu();
    downloadSelectedFiles();
});

document.getElementById('ctxDelete').addEventListener('click', () => {
    hideContextMenu();
    deleteSelectedFiles();
});

// ========== COPY/MOVE MODAL ==========

function openCopyMoveModal(operation) {
    copyMoveOperation = operation;
    const modal = document.getElementById('copyMoveModal');
    const title = document.getElementById('copyMoveTitle');
    const info = document.getElementById('copyMoveInfo');
    const pathInput = document.getElementById('copyMovePath');
    
    if (operation === 'copy') {
        title.innerHTML = '<i class="fas fa-copy"></i> Copiar para';
    } else {
        title.innerHTML = '<i class="fas fa-arrows-alt"></i> Mover para';
    }
    
    info.textContent = `${selectedFiles.length} item(ns) selecionado(s)`;
    pathInput.value = currentPath;
    modal.classList.add('active');
    pathInput.focus();
}

document.getElementById('cancelCopyMoveBtn').addEventListener('click', () => {
    document.getElementById('copyMoveModal').classList.remove('active');
});

document.getElementById('confirmCopyMoveBtn').addEventListener('click', () => {
    const destPath = document.getElementById('copyMovePath').value.trim();
    if (!destPath) {
        showToast('Informe o caminho de destino', 'error');
        return;
    }
    
    const files = selectedFiles.map(f => {
        return currentPath === '/' ? '/' + f.name : currentPath + '/' + f.name;
    });
    
    document.getElementById('copyMoveModal').classList.remove('active');
    executeCopyMove(copyMoveOperation, files, destPath);
});

// ========== COMPRESS MODAL ==========

function openCompressModal() {
    const modal = document.getElementById('compressModal');
    const info = document.getElementById('compressInfo');
    const nameInput = document.getElementById('zipFileName');
    
    info.textContent = `${selectedFiles.length} item(ns) selecionado(s)`;
    nameInput.value = 'arquivos.zip';
    modal.classList.add('active');
    nameInput.focus();
    nameInput.select();
}

document.getElementById('cancelCompressBtn').addEventListener('click', () => {
    document.getElementById('compressModal').classList.remove('active');
});

document.getElementById('confirmCompressBtn').addEventListener('click', () => {
    const zipName = document.getElementById('zipFileName').value.trim();
    if (!zipName) {
        showToast('Informe o nome do arquivo ZIP', 'error');
        return;
    }
    
    const files = selectedFiles.map(f => {
        return currentPath === '/' ? '/' + f.name : currentPath + '/' + f.name;
    });
    
    const zipPath = currentPath === '/' ? '/' + zipName : currentPath + '/' + zipName;
    
    socket.emit('sftp-compress', {
        files: files,
        zipPath: zipPath
    });
    
    document.getElementById('compressModal').classList.remove('active');
    showToast('Compactando arquivos...', 'info');
});

// ========== EXTRACT ==========

function extractFiles() {
    const zipFiles = selectedFiles.filter(f => 
        f.name.endsWith('.zip') || f.name.endsWith('.tar') || 
        f.name.endsWith('.gz') || f.name.endsWith('.tar.gz')
    );
    
    if (zipFiles.length === 0) {
        showToast('Selecione um arquivo compactado', 'error');
        return;
    }
    
    zipFiles.forEach(f => {
        const filePath = currentPath === '/' ? '/' + f.name : currentPath + '/' + f.name;
        socket.emit('sftp-extract', {
            file: filePath,
            destination: currentPath
        });
    });
    
    showToast('Descompactando...', 'info');
}

// ========== DOWNLOAD MULTIPLE ==========

function downloadSelectedFiles() {
    if (selectedFiles.length === 0) {
        showToast('Selecione arquivos para baixar', 'error');
        return;
    }
    
    if (selectedFiles.length === 1 && selectedFiles[0].type !== 'directory') {
        // Download simples
        const path = currentPath === '/' 
            ? '/' + selectedFiles[0].name 
            : currentPath + '/' + selectedFiles[0].name;
        socket.emit('sftp-download', path);
    } else {
        // Múltiplos arquivos - compactar e baixar
        const files = selectedFiles.map(f => {
            return currentPath === '/' ? '/' + f.name : currentPath + '/' + f.name;
        });
        
        socket.emit('sftp-download-multiple', { files, currentPath });
        showToast('Preparando download...', 'info');
    }
}

// ========== DELETE MULTIPLE ==========

function deleteSelectedFiles() {
    if (selectedFiles.length === 0 && !selectedFile) {
        showToast('Selecione arquivos para excluir', 'error');
        return;
    }
    
    const count = selectedFiles.length > 0 ? selectedFiles.length : 1;
    const fileName = selectedFiles.length === 1 ? selectedFiles[0].name : 
                     (selectedFiles.length === 0 && selectedFile ? selectedFile.name : '');
    
    if (count === 1 && fileName) {
        document.getElementById('deleteMessage').textContent = 
            `Tem certeza que deseja excluir "${fileName}"?`;
    } else {
        document.getElementById('deleteMessage').textContent = 
            `Tem certeza que deseja excluir ${count} item(ns)?`;
    }
    
    document.getElementById('deleteModal').classList.add('active');
}

// ========== SOCKET EVENTS ==========

socket.on('sftp-operation-success', (message) => {
    showToast(message, 'success');
    loadDirectory(currentPath);
    clearFileSelection();
});

socket.on('sftp-operation-error', (error) => {
    showToast('Erro: ' + error, 'error');
});

socket.on('sftp-download-ready', ({ fileName, data }) => {
    const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Download pronto: ' + fileName, 'success');
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

// File content for editor
socket.on('sftp-file-content', (data) => {
    console.log('=== File content received, length:', data.content ? data.content.length : 0);
    const content = data.content !== undefined ? data.content : '';
    
    if (monacoReady && monacoEditor && currentEditingFile) {
        console.log('Monaco ready, loading content directly');
        loadContentIntoEditor(content);
    } else {
        console.log('Monaco not ready, storing content');
        pendingFileContent = content;
    }
});

// File read error
socket.on('sftp-file-error', (error) => {
    console.error('File error:', error);
    showEditorLoading(false);
    showToast('Erro ao abrir arquivo: ' + error, 'error');
    closeEditor();
});

socket.on('sftp-file-saved', (data) => {
    const editorStatus = document.getElementById('editorStatus');
    showEditorLoading(false);
    editorStatus.textContent = 'Salvo!';
    showToast('Arquivo salvo com sucesso!', 'success');
    setTimeout(() => {
        editorStatus.textContent = 'Pronto';
    }, 2000);
});

// File save error
socket.on('sftp-save-error', (error) => {
    const editorStatus = document.getElementById('editorStatus');
    showEditorLoading(false);
    editorStatus.textContent = 'Erro ao salvar';
    showToast('Erro ao salvar: ' + error, 'error');
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

// Dropdown toggle
const newBtn = document.getElementById('newBtn');
const newDropdown = document.getElementById('newDropdown');

newBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    newDropdown.classList.toggle('show');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!newBtn.contains(e.target) && !newDropdown.contains(e.target)) {
        newDropdown.classList.remove('show');
    }
});

// New Folder
const newFolderModal = document.getElementById('newFolderModal');
document.getElementById('newFolderBtn').addEventListener('click', () => {
    newDropdown.classList.remove('show');
    document.getElementById('folderName').value = '';
    newFolderModal.classList.add('active');
    document.getElementById('folderName').focus();
});

document.getElementById('cancelFolderBtn').addEventListener('click', () => {
    newFolderModal.classList.remove('active');
});

document.getElementById('createFolderBtn').addEventListener('click', () => {
    const name = document.getElementById('folderName').value.trim();
    if (name) {
        const newPath = currentPath === '/' 
            ? '/' + name 
            : currentPath + '/' + name;
        socket.emit('sftp-mkdir', newPath);
        newFolderModal.classList.remove('active');
    }
});

// Enter key for folder creation
document.getElementById('folderName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('createFolderBtn').click();
    }
});

// New File
const newFileModal = document.getElementById('newFileModal');
document.getElementById('newFileBtn').addEventListener('click', () => {
    newDropdown.classList.remove('show');
    document.getElementById('fileName').value = '';
    newFileModal.classList.add('active');
    document.getElementById('fileName').focus();
});

document.getElementById('cancelFileBtn').addEventListener('click', () => {
    newFileModal.classList.remove('active');
});

document.getElementById('createFileBtn').addEventListener('click', () => {
    const name = document.getElementById('fileName').value.trim();
    if (name) {
        const newPath = currentPath === '/' 
            ? '/' + name 
            : currentPath + '/' + name;
        socket.emit('sftp-create-file', newPath);
        newFileModal.classList.remove('active');
    }
});

// Enter key for file creation
document.getElementById('fileName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('createFileBtn').click();
    }
});

// Delete
const deleteModal = document.getElementById('deleteModal');
document.getElementById('deleteBtn').addEventListener('click', () => {
    if (selectedFiles.length === 0 && !selectedFile) {
        showToast('Selecione um arquivo ou pasta', 'error');
        return;
    }
    deleteSelectedFiles();
});

document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
    deleteModal.classList.remove('active');
});

document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
    const filesToDelete = selectedFiles.length > 0 ? [...selectedFiles] : (selectedFile ? [selectedFile] : []);
    
    if (filesToDelete.length === 0) {
        deleteModal.classList.remove('active');
        return;
    }
    
    deleteModal.classList.remove('active');
    
    // Construir lista de caminhos
    const paths = filesToDelete.map(file => {
        return currentPath === '/' ? '/' + file.name : currentPath + '/' + file.name;
    });
    
    console.log('Deleting files:', paths);
    showToast(`Excluindo ${filesToDelete.length} item(ns)...`, 'info');
    
    // Usar comando rm -rf para deletar tudo de uma vez
    socket.emit('sftp-delete-files', { paths }, (response) => {
        console.log('Delete response:', response);
        if (response && response.error) {
            showToast('Erro ao excluir: ' + response.error, 'error');
        } else {
            showToast(`${filesToDelete.length} item(ns) excluído(s)`, 'success');
            loadDirectory(currentPath);
        }
    });
    
    clearFileSelection();
    selectedFile = null;
});

// Upload
document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', (e) => {
    const files = e.target.files;
    if (files.length === 0) return;
    
    showToast(`Enviando ${files.length} arquivo(s)...`, 'info');
    
    for (const file of files) {
        console.log('Uploading file:', file.name, 'size:', file.size);
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = btoa(
                new Uint8Array(reader.result)
                    .reduce((data, byte) => data + String.fromCharCode(byte), '')
            );
            console.log('Sending upload event for:', file.name);
            socket.emit('sftp-upload', {
                remotePath: currentPath,
                fileName: file.name,
                data: base64
            });
        };
        reader.onerror = () => {
            showToast('Erro ao ler arquivo: ' + file.name, 'error');
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
    // Refit terminal after animation
    setTimeout(() => {
        if (fitAddon && term) {
            fitAddon.fit();
            if (isConnected) {
                socket.emit('ssh-resize', {
                    cols: term.cols,
                    rows: term.rows
                });
            }
        }
    }, 150);
}

toggleSftpBtn.addEventListener('click', toggleSftp);
hideSftpBtn.addEventListener('click', toggleSftp);

// Fullscreen
const fullscreenBtn = document.getElementById('fullscreenBtn');

function toggleFullscreen() {
    document.body.classList.toggle('fullscreen-mode');
    const icon = fullscreenBtn.querySelector('i');
    
    if (document.body.classList.contains('fullscreen-mode')) {
        icon.className = 'fas fa-compress';
        fullscreenBtn.title = 'Sair da Tela Cheia';
        showToast('Pressione ESC para sair da tela cheia', 'info');
    } else {
        icon.className = 'fas fa-expand';
        fullscreenBtn.title = 'Tela Cheia';
    }
    
    // Refit terminal after transition
    setTimeout(() => {
        if (fitAddon && term) {
            fitAddon.fit();
            if (isConnected) {
                socket.emit('ssh-resize', {
                    cols: term.cols,
                    rows: term.rows
                });
            }
        }
    }, 150);
}

fullscreenBtn.addEventListener('click', toggleFullscreen);

// ESC to exit fullscreen
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen-mode')) {
        toggleFullscreen();
    }
});

// Utility functions
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i> ${message}`;
    toastContainer.appendChild(toast);
    const duration = type === 'info' ? 2500 : 5000;
    setTimeout(() => toast.remove(), duration);
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
            if (overlay.id === 'editorModal') {
                closeEditor();
            }
        }
    });
});

// Editor buttons
document.getElementById('saveFileBtn').addEventListener('click', saveCurrentFile);
document.getElementById('closeEditorBtn').addEventListener('click', closeEditor);



// Clear credentials button
document.getElementById('clearCredentialsBtn').addEventListener('click', clearSavedCredentials);

// Load saved credentials on page load
document.addEventListener('DOMContentLoaded', loadSavedCredentials);

// ========== GLOBAL KEYBOARD SHORTCUTS ==========
document.addEventListener('keydown', (e) => {
    // Ignorar se estiver digitando em input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // Ignorar se modal de editor estiver aberto (Monaco tem seus próprios atalhos)
    if (document.getElementById('editorModal').classList.contains('active')) {
        return;
    }
    
    // Ignorar se outro modal estiver aberto
    const activeModal = document.querySelector('.modal-overlay.active:not(#editorModal)');
    if (activeModal) {
        if (e.key === 'Escape') {
            activeModal.classList.remove('active');
        }
        return;
    }
    
    // Apenas funciona se conectado e SFTP visível
    if (!isConnected) return;
    
    // Ctrl+A - Selecionar tudo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAllFiles();
        return;
    }
    
    // Ctrl+C - Copiar
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedFiles.length > 0) {
            e.preventDefault();
            copyToClipboard(false);
        }
        return;
    }
    
    // Ctrl+X - Recortar
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (selectedFiles.length > 0) {
            e.preventDefault();
            copyToClipboard(true);
        }
        return;
    }
    
    // Ctrl+V - Colar
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboard.files && clipboard.files.length > 0) {
            e.preventDefault();
            pasteFromClipboard();
        }
        return;
    }
    
    // Delete - Excluir
    if (e.key === 'Delete') {
        if (selectedFiles.length > 0 || selectedFile) {
            e.preventDefault();
            deleteSelectedFiles();
        }
        return;
    }
    
    // Escape - Cancelar seleção ou sair do fullscreen
    if (e.key === 'Escape') {
        if (document.body.classList.contains('fullscreen-mode')) {
            toggleFullscreen();
        } else if (selectedFiles.length > 0) {
            clearFileSelection();
        }
        return;
    }
});


