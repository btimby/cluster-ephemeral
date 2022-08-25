const EventEmitter = require('events');

class BaseListener {
  constructor(portRange) {
    this.portRange = portRange;
  }

  _choosePort() {
    const span = this.portRange.high - this.portRange.low;
    const rand = Math.random();

    return this.portRange.low + Math.floor(rand * span);
  }

  _checkPort(port) {
    if (!this.portRange) return;

    if (this.portRange.high < port < this.portRange.low) {
      throw new Error(`Port ${port} not in range ${this.portRange.low}-${this.portRange.high}`);
    }
  }
}

class SocketListener extends BaseListener {
  keepOpen = false

  constructor(portRange) {
    super(portRange);
    this.portRange = portRange;
  }

  _choosePort(host) {
    let port = 0;
    const socket = new TCP();

    while (true) {
      if (this.portRange) {
        port = super._choosePort();
      }

      try {
        socket.bind(host, port);
        return socket;
      } catch (e) {
        continue;
      }
    }
  }

  listen(port, host, callback) {
    /*
      Bind socket directly, then open listener on that handle.
      This bypasses cluster's special handling of listen, we
      don't want it's routing.
    */
    let socket;
    if (port === 0) {
      socket = this._choosePort(host);
    } else {
      this._checkPort(port);
      socket = new TCP();
      socket.bind(host, port);
    }

    return net.createServer().listen(socket, callback);
  }
}

class ProxyServer extends EventEmitter {
  /*
    Dummy "net.Server".
  */
  constructor(listener, port, callback) {
    super();
    this.listener = listener;
    this.port = port;

    if (callback) {
      this.on('connection', callback);
    }
  }

  address() {
    return { port: this.port, host: this.listener.host };
  }

  _connection(socket) {
    this.emit('connection', socket);
  }

  close() {
    this.listener.close(this);
  }
}

class ProxyListener extends BaseListener {
  keepOpen = true

  constructor(port, host, portRange) {
    super(portRange);
    this.servers = {};
    this.usedPorts = new Set();
    this.server = new SocketListener();
    this.server.listen(port, host, (socket) => this._connection(socket));
  }

  _connection(socket) {
    const server = this.servers[socket.localPort];
    server._connection(socket);
  }

  _choosePort() {
    // NOTE: ports are virtual, just select one at random from our range
    // that is not already present in this.usedPorts.
    while (true) {
      const port = super._choosePort();
      if (!this.servers[port]) return port;
    }
  }

  listen(port, host, callback) {
    if (port === 0) {
      port = this._choosePort();
    }

    this._checkport(port);

    const server = new ProxyServer(this, port, callback);
    this.servers[port] = server;
    return server;
  }

  close(server) {
    delete this.servers[server.port];
  }
}

module.exports = {
  SocketListener,
  ProxyListener,
};
