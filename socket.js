const { Server } = require('socket.io');
const db = require('./db')
const moment = require('moment');

function setupSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["my-custom-header"],
      credentials: true,
    },
  });

  io.on('connect', (socket) => {
    let identificador = null

    socket.on('usuario conectado', (identifier) => {
      console.log('usuario conectado', identifier)
      socket.join(identifier);
      identificador = identifier
    })

    socket.on('pesquisar', async (identifier) => {
      if (identifier.trim() !== '') {
        try {
          const resultadoPesquisa = await db.promise().query('SELECT  nome, email, identifier, url_imagem FROM Users WHERE identifier LIKE ?', [`%${identifier}%`]);

          if (resultadoPesquisa[0].length > 0) {
            io.to(socket.id).emit('resultadoPesquisa', resultadoPesquisa[0]);
          } else {
            io.to(socket.id).emit('resultadoPesquisa', []);
          }
        } catch (error) {
          console.error('Erro durante a pesquisa:', error.message);
          io.to(socket.id).emit('erroPesquisa', { mensagem: 'Erro durante a pesquisa' });
        }
      } else {
        io.to(socket.id).emit('resultadoPesquisa', []);
      }
    });

    socket.on('adicionar', async (usuarioPesquisado, usuarioLogado) => {
      try {
        const existeRelacao = await db.promise().query('SELECT * FROM ListUsers WHERE TRIM(identifier) = ? AND TRIM(identifier_friend) = ?', [usuarioLogado.identifier, usuarioPesquisado.identifier]);

        if (existeRelacao[0].length === 0) {
          await db.promise().query('INSERT INTO ListUsers (identifier, identifier_friend, nome, email, url_img) VALUES (?, ?, ?, ?, ?)', [usuarioPesquisado.identifier, usuarioPesquisado.identifier_friend, usuarioPesquisado.nome, usuarioPesquisado.email, usuarioPesquisado.img]);

          await db.promise().query('INSERT INTO ListUsers (identifier, identifier_friend, nome, email, url_img) VALUES (?, ?, ?, ?, ?)', [usuarioLogado.identifier, usuarioLogado.identifier_friend, usuarioLogado.nome, usuarioLogado.email, usuarioLogado.img]);

          const novaLista = await obterListaUsuarios(usuarioPesquisado.identifier_friend);
          const newLista = await obterListaUsuarios(usuarioLogado.identifier_friend);

          io.to(usuarioPesquisado.identifier_friend).emit('lista', novaLista);

          io.to(usuarioLogado.identifier_friend).emit('lista', newLista);

          io.to(usuarioPesquisado.identifier_friend).emit('notificationEnviada', { mensagem: usuarioLogado });

          io.to(usuarioLogado.identifier_friend).emit('sucess', { mensagem: 'Usuario Adicionado com sucesso!' })
        } else {
          io.to(usuarioLogado.identifier_friend).emit('notificationRecebida', { mensagem: 'A relação já existe na tabela ListUsers' });
        }
      } catch (error) {
        console.error('Erro durante a adição:', error.message);
        io.to(socket.id).emit('erroAdicao', { mensagem: 'Erro durante a adição de usuários' });
      }
    });

    socket.on('listaUsuarios', async (identifier) => {
      try {
        const results = await obterListaUsuarios(identifier);
        io.to(identifier).emit('lista', results);
      } catch (error) {
        io.to(identifier).emit('lista', { mensagem: [] });
      }
    });

    socket.on('mensagem', async (data) => {
      try {
        const horaEnvio = moment().format('YYYY-MM-DD HH:mm:ss');

        await db.promise().query(
          'INSERT INTO chatHistory (remetente, destinatario, mensagem, hora_envio) VALUES (?, ?, ?, ?)',
          [data.userLog.identifier, data.userSelected.identifier, data.mensagemText, horaEnvio]
        );

        socket.emit('mensagemEnviada', {
          remetente: data.userLog.identifier,
          nome: `Eu: ${data.userLog.nome}`,
          email: data.userLog.email,
          img: data.userLog.img,
          message: data.mensagemText,
          hora: horaEnvio,
          destinatario: data.userSelected.identifier
        });

        socket.to(data.userSelected.identifier).emit('novaMensagem', {
          remetente: data.userLog.identifier,
          nome: `Enviada de: ${data.userLog.nome}`,
          email: data.userLog.email,
          img: data.userLog.img,
          message: data.mensagemText,
          hora: horaEnvio,
          destinatario: data.userSelected.identifier
        });

      } catch (erro) {
        console.log('Erro ao adicionar mensagem:', erro);

        socket.emit('mensagemErro', { sucesso: false, mensagem: 'Erro ao enviar a mensagem.' });
      }
    });

    socket.on('buscarHistorico', async (data) => {
      try {
        const remetente = data.identifier;
        const destinatario = data.identifier_friend;

        const [rows] = await db.promise().query(
          `
          SELECT 
            chatHistory.hora_envio,
            chatHistory.mensagem,
            usuarios.email AS emailRemetente,
            usuarios.url_imagem AS urlImagemRemetente,
            usuarios.nome AS nomeRemetente,
            chatHistory.remetente,
            chatHistory.destinatario
          FROM chatHistory
          LEFT JOIN Users AS usuarios ON chatHistory.remetente = usuarios.identifier
          WHERE (chatHistory.remetente = ? AND chatHistory.destinatario = ?)
            OR (chatHistory.remetente = ? AND chatHistory.destinatario = ?)
          ORDER BY chatHistory.hora_envio
          `,
          [remetente, destinatario, destinatario, remetente]
        );

        if (rows.length > 0) {

          const historicoSimplificado = rows.map((mensagem) => ({
            email: mensagem.emailRemetente,
            hora: mensagem.hora_envio,
            img: mensagem.urlImagemRemetente,
            message: mensagem.mensagem,
            nome: mensagem.nomeRemetente,
            remetente: mensagem.remetente,  
            destinatario: mensagem.destinatario,
          }));

          // socket.emit('historicoMensagens', { historico: historicoSimplificado });
          io.to(data.identifier).emit('historicoMensagens', { historico: historicoSimplificado });
        } else {
          console.log('Nenhum mensagem a ser exibida!')
        }
      } catch (erro) {
        console.log('Erro ao buscar histórico de mensagens:', erro);

        socket.emit('historicoMensagensErro', { sucesso: false, mensagem: 'Erro ao buscar histórico de mensagens.' });
      }
    });

    socket.on('disconnect', () => {
      console.log('usuario desconectado', identificador)
    })

  });
};

async function obterListaUsuarios(identifier) {
  try {
    const [results] = await db.promise().query(
      'SELECT U.nome, U.email, U.identifier, U.url_imagem ' +
      'FROM Users U ' +
      'INNER JOIN ListUsers L ON U.identifier = L.identifier_friend ' +
      'WHERE L.identifier = ?',
      [identifier]
    );
    return results.length > 0 ? results : [];
  } catch (error) {
    console.error('Erro ao recuperar a lista de amigos:', error.message);
    throw error;
  }
}

module.exports = setupSocket;
