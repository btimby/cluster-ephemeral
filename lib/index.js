const cluster = require('cluster');
const { SocketListener, ProxyListener } = require('./listeners');

function cookie(length) {
  var result = '';
  var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;

  for ( var i = 0; i < length; i++ ) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}

class EphemeralServer {
  /*
    Allows a worker to bind a specific port. When a connection arrives, it
    is routed to the proper worker.
  */
  constructor({proxyPort, portRange}) {
    if (portRange) {
      if (!isNumeric(portRange.low) || !isNumeric(portRange.high)) {
        throw new Error('portRange must be object with high and low properties');
      }
    }

    if (proxyPort) {
      if (!isNumeric(proxyPort)) {
        throw new Error('proxyPort must be a numeral');
      }
      // When using PROXY PROTOCOL, we bind a single port, then use the PROXY
      // header to determine the "actual" port that the connection arrived on.
      this.listener = new ProxyListener(proxyPort, proxyHost, portRange);
    } else {
      this.listener = new SocketListener(portRange);
    }

    this.requests = {};

    if (cluster.isPrimary) {
      cluster.on('fork', (worker) => {
        worker.on('message', (msg) => this._listen(msg.id, msg.listen, worker));
      });
    } else if (cluster.isWorker) {
      cluster.worker.on('message', (msg, socket) => this._listening(msg.id, msg.bind, socket));
    }
  }

  _listen(id, { port, host }, worker) {
    // Request to listen on new port.
    try {
      this.listener.listen(port, host, (socket) => {
        worker.send({ id, bind: { port, host }}, socket, { keepOpen: this.listener.keepOpen });
      });
    } catch (e) {
      worker.send({ id, bind: { port, host, error: e.message }});
    }
  }

  _listening(id, bind, socket) {
    // Response to listen request.
    const callback = this.requests[id];

    if (!callback) {
      throw new Error(`No outstanding request for id: ${id}`);
    }

    if (bind.error) {
      callback(null, new Error(bind.error));
      delete this.requests[id];
      return;
    }

    callback(socket);
  }

  listen(port, host, callback) {
    // Called in worker, requests that primary open port.
    if (cluster.isPrimary) {
      callback(null, new Error("Don't call me from primary."));
      return;
    }

    const id = cookie(10);
    this.requests[id] = callback;

    process.send({
      id,
      listen: { port, host },
    });
  }
}

module.exports = EphemeralServer;
