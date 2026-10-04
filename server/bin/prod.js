const config = require('../config');
const { server } = require('../app').createApp();

server.listen(config.listen_port, config.listen_address);
