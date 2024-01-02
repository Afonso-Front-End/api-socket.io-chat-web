const express = require('express');
const cors = require('cors');
const http = require('http');
const setupSocket = require('./socket');


const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

setupSocket(server);

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Servidor ouvindo na porta ${PORT}`);
});
