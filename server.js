const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client } = require('ssh2');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  path: '/ssh/socket.io',
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Configurar upload de arquivos
const upload = multer({ dest: 'uploads/' });

// Servir arquivos estáticos
app.use('/ssh', express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Rota principal
app.get('/ssh', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Armazenar conexões SSH e sessões SFTP ativas
const sshConnections = new Map();
const sftpSessions = new Map();

// Helper para obter sessão SFTP reutilizável
function getSftpSession(socketId, callback) {
  const client = sshConnections.get(socketId);
  if (!client) {
    callback(new Error('Não conectado'), null);
    return;
  }

  // Reutilizar sessão existente
  const existingSession = sftpSessions.get(socketId);
  if (existingSession) {
    callback(null, existingSession);
    return;
  }

  // Criar nova sessão
  client.sftp((err, sftp) => {
    if (err) {
      callback(err, null);
      return;
    }
    sftpSessions.set(socketId, sftp);
    callback(null, sftp);
  });
}

// Socket.io para terminal SSH
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  
  let sshClient = null;
  let stream = null;

  // Debug: log all incoming events
  socket.onAny((eventName, ...args) => {
    console.log('Event received:', eventName);
  });

  // Test ping
  socket.on('ping-test', (callback) => {
    console.log('Ping received from client');
    if (callback) callback({ pong: true, time: Date.now() });
  });

  socket.on('ssh-connect', (config) => {
    sshClient = new Client();
    
    const connectionConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
    };

    if (config.privateKey) {
      connectionConfig.privateKey = config.privateKey;
      if (config.passphrase) {
        connectionConfig.passphrase = config.passphrase;
      }
    } else {
      connectionConfig.password = config.password;
    }

    sshClient.on('ready', () => {
      console.log('SSH conectado para:', config.host);
      socket.emit('ssh-ready');
      
      // Armazenar cliente para SFTP
      sshConnections.set(socket.id, sshClient);

      sshClient.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, shellStream) => {
        if (err) {
          socket.emit('ssh-error', err.message);
          return;
        }
        
        stream = shellStream;
        
        stream.on('data', (data) => {
          socket.emit('ssh-data', data.toString('utf-8'));
        });
        
        stream.on('close', () => {
          socket.emit('ssh-close');
          sshClient.end();
        });

        stream.stderr.on('data', (data) => {
          socket.emit('ssh-data', data.toString('utf-8'));
        });
      });
    });

    sshClient.on('error', (err) => {
      console.error('SSH error:', err.message);
      socket.emit('ssh-error', err.message);
    });

    sshClient.on('close', () => {
      socket.emit('ssh-close');
      sftpSessions.delete(socket.id);
      sshConnections.delete(socket.id);
    });

    sshClient.connect(connectionConfig);
  });

  socket.on('ssh-data', (data) => {
    if (stream) {
      stream.write(data);
    }
  });

  socket.on('ssh-resize', (size) => {
    if (stream) {
      stream.setWindow(size.rows, size.cols, size.height, size.width);
    }
  });

  // SFTP Operations
  socket.on('sftp-list', (remotePath) => {
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        socket.emit('sftp-error', err.message);
        return;
      }

      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          socket.emit('sftp-error', err.message);
          return;
        }

        const files = list.map(item => ({
          name: item.filename,
          type: item.longname.charAt(0) === 'd' ? 'directory' : 'file',
          size: item.attrs.size,
          modified: new Date(item.attrs.mtime * 1000).toISOString(),
          permissions: item.longname.substring(0, 10)
        }));

        socket.emit('sftp-list', { path: remotePath, files });
      });
    });
  });

  socket.on('sftp-mkdir', (remotePath) => {
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        socket.emit('sftp-error', err.message);
        return;
      }

      sftp.mkdir(remotePath, (err) => {
        if (err) {
          socket.emit('sftp-error', err.message);
          return;
        }
        socket.emit('sftp-success', 'Pasta criada com sucesso');
      });
    });
  });

  // Create empty file
  socket.on('sftp-create-file', (remotePath) => {
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        socket.emit('sftp-error', err.message);
        return;
      }

      sftp.writeFile(remotePath, '', 'utf8', (err) => {
        if (err) {
          socket.emit('sftp-error', err.message);
          return;
        }
        socket.emit('sftp-success', 'Arquivo criado com sucesso');
      });
    });
  });

  socket.on('sftp-delete', ({ path: remotePath, isDirectory }) => {
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        socket.emit('sftp-error', err.message);
        return;
      }

      const deleteFunc = isDirectory ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp);
      deleteFunc(remotePath, (err) => {
        if (err) {
          socket.emit('sftp-error', err.message);
          return;
        }
        socket.emit('sftp-success', 'Excluído com sucesso');
      });
    });
  });

  // Delete with callback (for multiple files)
  socket.on('sftp-delete-item', ({ path: remotePath, isDirectory }, callback) => {
    console.log('Deleting:', remotePath, 'isDirectory:', isDirectory);
    
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        console.error('SFTP error:', err.message);
        if (callback) callback({ error: err.message });
        return;
      }

      if (isDirectory) {
        // Para diretórios, usar rm -rf via exec para deletar recursivamente
        const client = sshConnections.get(socket.id);
        client.exec(`rm -rf "${remotePath}"`, (err, stream) => {
          if (err) {
            console.error('Exec error:', err.message);
            if (callback) callback({ error: err.message });
            return;
          }
          
          stream.on('close', (code) => {
            if (code === 0) {
              console.log('Deleted directory:', remotePath);
              if (callback) callback({ success: true });
            } else {
              if (callback) callback({ error: 'Erro ao excluir diretório' });
            }
          });
        });
      } else {
        sftp.unlink(remotePath, (err) => {
          if (err) {
            console.error('Delete error:', err.message);
            if (callback) callback({ error: err.message });
            return;
          }
          console.log('Deleted file:', remotePath);
          if (callback) callback({ success: true });
        });
      }
    });
  });

  socket.on('sftp-download', (remotePath) => {
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        socket.emit('sftp-error', err.message);
        return;
      }

      sftp.readFile(remotePath, (err, data) => {
        if (err) {
          socket.emit('sftp-error', err.message);
          return;
        }
        const fileName = path.basename(remotePath);
        socket.emit('sftp-download', { fileName, data: data.toString('base64') });
      });
    });
  });

  socket.on('sftp-upload', ({ remotePath, fileName, data }) => {
    console.log('Upload file:', fileName, 'to:', remotePath);
    
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        console.error('SFTP session error:', err.message);
        socket.emit('sftp-error', err.message);
        return;
      }

      const buffer = Buffer.from(data, 'base64');
      const fullPath = remotePath.endsWith('/') ? remotePath + fileName : remotePath + '/' + fileName;
      
      console.log('Writing to:', fullPath, 'size:', buffer.length);
      
      sftp.writeFile(fullPath, buffer, (err) => {
        if (err) {
          console.error('Write error:', err.message);
          socket.emit('sftp-error', err.message);
          return;
        }
        console.log('Upload success:', fullPath);
        socket.emit('sftp-success', 'Upload concluído: ' + fileName);
      });
    });
  });

  // Read file content for editor
  socket.on('sftp-read-file', (remotePath, callback) => {
    console.log('=== Reading file:', remotePath);
    
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        console.error('SFTP session error:', err.message);
        socket.emit('sftp-file-error', err.message);
        if (callback) callback({ error: err.message });
        return;
      }

      console.log('SFTP session ready, reading file...');
      
      sftp.readFile(remotePath, 'utf8', (err, content) => {
        if (err) {
          console.error('Read file error:', err.message);
          socket.emit('sftp-file-error', err.message);
          if (callback) callback({ error: err.message });
          return;
        }
        
        console.log('File read successfully, length:', content.length);
        socket.emit('sftp-file-content', { content: content, path: remotePath });
        if (callback) callback({ success: true });
      });
    });
  });

  // Write file content from editor
  socket.on('sftp-write-file', ({ path: remotePath, content }) => {
    console.log('Writing file:', remotePath);
    
    getSftpSession(socket.id, (err, sftp) => {
      if (err) {
        console.error('SFTP error:', err.message);
        socket.emit('sftp-save-error', err.message);
        return;
      }

      sftp.writeFile(remotePath, content, 'utf8', (err) => {
        if (err) {
          console.error('Write file error:', err.message);
          socket.emit('sftp-save-error', err.message);
          return;
        }
        console.log('File saved successfully');
        socket.emit('sftp-file-saved', { path: remotePath });
      });
    });
  });

  // Copy or Move files
  socket.on('sftp-copy-move', ({ operation, files, destination }) => {
    console.log(`${operation} files:`, files, 'to:', destination);
    const client = sshConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-operation-error', 'Não conectado');
      return;
    }

    const command = operation === 'copy' ? 'cp -r' : 'mv';
    const fileList = files.map(f => `"${f}"`).join(' ');
    const cmd = `${command} ${fileList} "${destination}/"`;
    
    client.exec(cmd, (err, stream) => {
      if (err) {
        socket.emit('sftp-operation-error', err.message);
        return;
      }
      
      let errorOutput = '';
      stream.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      stream.on('close', (code) => {
        if (code === 0) {
          socket.emit('sftp-operation-success', 
            `${operation === 'copy' ? 'Copiado' : 'Movido'} com sucesso!`);
        } else {
          socket.emit('sftp-operation-error', errorOutput || 'Erro na operação');
        }
      });
    });
  });

  // Compress files to ZIP
  socket.on('sftp-compress', ({ files, zipPath }) => {
    console.log('Compressing files:', files, 'to:', zipPath);
    const client = sshConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-operation-error', 'Não conectado');
      return;
    }

    // Usar zip para compactar
    const fileList = files.map(f => `"${f}"`).join(' ');
    const cmd = `zip -r "${zipPath}" ${fileList}`;
    
    client.exec(cmd, (err, stream) => {
      if (err) {
        socket.emit('sftp-operation-error', err.message);
        return;
      }
      
      let errorOutput = '';
      stream.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      stream.on('close', (code) => {
        if (code === 0) {
          socket.emit('sftp-operation-success', 'Arquivos compactados com sucesso!');
        } else {
          socket.emit('sftp-operation-error', errorOutput || 'Erro ao compactar');
        }
      });
    });
  });

  // Extract archive
  socket.on('sftp-extract', ({ file, destination }) => {
    console.log('Extracting:', file, 'to:', destination);
    const client = sshConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-operation-error', 'Não conectado');
      return;
    }

    let cmd;
    if (file.endsWith('.zip')) {
      cmd = `unzip -o "${file}" -d "${destination}"`;
    } else if (file.endsWith('.tar.gz') || file.endsWith('.tgz')) {
      cmd = `tar -xzf "${file}" -C "${destination}"`;
    } else if (file.endsWith('.tar')) {
      cmd = `tar -xf "${file}" -C "${destination}"`;
    } else if (file.endsWith('.gz')) {
      cmd = `gunzip -k "${file}"`;
    } else {
      socket.emit('sftp-operation-error', 'Formato não suportado');
      return;
    }
    
    client.exec(cmd, (err, stream) => {
      if (err) {
        socket.emit('sftp-operation-error', err.message);
        return;
      }
      
      let errorOutput = '';
      stream.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      stream.on('close', (code) => {
        if (code === 0) {
          socket.emit('sftp-operation-success', 'Arquivos extraídos com sucesso!');
        } else {
          socket.emit('sftp-operation-error', errorOutput || 'Erro ao extrair');
        }
      });
    });
  });

  // Download multiple files (compress and send)
  socket.on('sftp-download-multiple', ({ files, currentPath }) => {
    console.log('Download multiple:', files);
    const client = sshConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-operation-error', 'Não conectado');
      return;
    }

    const tmpZip = `/tmp/download_${Date.now()}.zip`;
    const fileList = files.map(f => `"${f}"`).join(' ');
    const cmd = `cd "${currentPath}" && zip -r "${tmpZip}" ${files.map(f => `"${path.basename(f)}"`).join(' ')}`;
    
    client.exec(cmd, (err, stream) => {
      if (err) {
        socket.emit('sftp-operation-error', err.message);
        return;
      }
      
      stream.on('close', (code) => {
        if (code !== 0) {
          socket.emit('sftp-operation-error', 'Erro ao criar arquivo ZIP');
          return;
        }
        
        // Ler o arquivo ZIP criado
        getSftpSession(socket.id, (err, sftp) => {
          if (err) {
            socket.emit('sftp-operation-error', err.message);
            return;
          }
          
          sftp.readFile(tmpZip, (err, data) => {
            if (err) {
              socket.emit('sftp-operation-error', err.message);
              return;
            }
            
            socket.emit('sftp-download-ready', {
              fileName: 'download.zip',
              data: data.toString('base64')
            });
            
            // Limpar arquivo temporário
            client.exec(`rm "${tmpZip}"`, () => {});
          });
        });
      });
    });
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    if (sshClient) {
      sshClient.end();
    }
    sftpSessions.delete(socket.id);
    sshConnections.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3022;
server.listen(PORT, () => {
  console.log(`SSH Web Client rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}/ssh`);
});
