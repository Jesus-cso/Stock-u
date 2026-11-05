const mysql = require('mysql');

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'stock_upt'
};

let connection;

function handleDisconnect() {
  connection = mysql.createConnection(dbConfig);

  connection.connect((err) => {
    if (err) {
      console.error('Error al conectar a MySQL, reintentando en 2 segundos...', err);
      setTimeout(handleDisconnect, 2000);
    } else {
      console.log('¡Conectado exitosamente a MySQL!');
    }
  });

  connection.on('error', (err) => {
    console.error('Error en la base de datos:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET') {
      handleDisconnect(); // Reconecta automáticamente si se cae
    } else {
      throw err;
    }
  });
}

handleDisconnect();

// --- SISTEMA KEEP-ALIVE ---
// Hace un ping a la base de datos cada 5 minutos (300000 ms) para que no expire por inactividad
setInterval(() => {
  if (connection) {
    connection.ping((err) => {
      if (err) {
        console.error('Error en el ping de Keep-Alive:', err);
      } else {
        console.log('Keep-Alive: Ping enviado a MySQL correctamente.');
      }
    });
  }
}, 300000);