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

// Armazenar conexões SFTP ativas
const sftpConnections = new Map();

// Socket.io para terminal SSH
io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);
  
  let sshClient = null;
  let stream = null;

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
      sftpConnections.set(socket.id, sshClient);

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
      sftpConnections.delete(socket.id);
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
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
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
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
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
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
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
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
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

  socket.on('sftp-download', (remotePath) => {
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
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
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
      if (err) {
        socket.emit('sftp-error', err.message);
        return;
      }

      const buffer = Buffer.from(data, 'base64');
      const fullPath = remotePath.endsWith('/') ? remotePath + fileName : remotePath + '/' + fileName;
      
      sftp.writeFile(fullPath, buffer, (err) => {
        if (err) {
          socket.emit('sftp-error', err.message);
          return;
        }
        socket.emit('sftp-success', 'Upload concluído');
      });
    });
  });

  // Read file content for editor
  socket.on('sftp-read-file', (remotePath) => {
    console.log('Reading file:', remotePath);
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-error', 'Não conectado');
      socket.emit('sftp-file-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP error:', err.message);
        socket.emit('sftp-file-error', err.message);
        return;
      }

      // First check file stats to get size
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          console.error('Stat error:', err.message);
          socket.emit('sftp-file-error', err.message);
          return;
        }

        // Limit file size to 5MB for editor
        const maxSize = 5 * 1024 * 1024;
        if (stats.size > maxSize) {
          socket.emit('sftp-file-error', 'Arquivo muito grande para editar (máx 5MB)');
          return;
        }

        sftp.readFile(remotePath, (err, buffer) => {
          if (err) {
            console.error('Read file error:', err.message);
            socket.emit('sftp-file-error', err.message);
            return;
          }
          // Convert buffer to string
          const content = buffer.toString('utf8');
          console.log('File read successfully, length:', content.length);
          socket.emit('sftp-file-content', { content: content, path: remotePath });
        });
      });
    });
  });

  // Write file content from editor
  socket.on('sftp-write-file', ({ path: remotePath, content }) => {
    console.log('Writing file:', remotePath);
    const client = sftpConnections.get(socket.id);
    if (!client) {
      socket.emit('sftp-save-error', 'Não conectado');
      return;
    }

    client.sftp((err, sftp) => {
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

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    if (sshClient) {
      sshClient.end();
    }
    sftpConnections.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3022;
server.listen(PORT, () => {
  console.log(`SSH Web Client rodando na porta ${PORT}`);
  console.log(`Acesse: http://localhost:${PORT}/ssh`);
});
