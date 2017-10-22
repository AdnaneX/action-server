const net = require('net')
const Rx = require('rxjs')
const { v4: uuid } = require('uuid')
const { ensure } = require('./utils')

const makeParser = require('./parser')
const parser = makeParser()

const DEFAULT_OPTS = {
  SERVER_NAME: 'test_master',
  MESSAGE_PREFIX: `MESSAGE_test_master`,
  parser
}

module.exports = (opts = {}) => {
  // Configuration object
  const config = ensure(DEFAULT_OPTS, opts)

  // Our connected Sockets
  const sockets = new Map()

  const ids = new Map()

  const getSocket = id => sockets.get(id)
  const getId = socket => ids.get(socket)

  const setSocket = socket => {
    // TODO: set this via `encoder`
    socket.setEncoding('utf8')

    const _id = uuid()
    sockets.set(_id, socket)
    ids.set(socket, _id)

    return _id
  }

  const server = net.createServer({ allowHalfOpen: true })

  const socketStream = Rx.Observable.fromEvent(server, 'connection')
    .share()

  const removeSocket = socket => () => {
    const id = ids.get(socket)
    sockets.delete(id)
    ids.delete(socket)

    return id
  }
  
  const socketObservable = socket => setSocket(socket) && Rx.Observable
    // We emit a single 'CONNECTION' event to our system
    .of({
      data: {
        action: 'CONNECTION',
        socket: getId(socket)
      }
    }).merge(
      // Then we set up an observable of the messages
      // sent from this socket
      Rx.Observable
        .fromEvent(socket, 'data')
        // Then we decode the message
        .map(config.parser.decode)
        // And finally we wrap it up so the system
        // knows what socket sent this
        .map(message => Object.assign({}, message, {
          socket: getId(socket),
        }))
    )
    // I am going to take the above until
    .takeUntil(
      // I either get a close event
      Rx.Observable.fromEvent(socket, 'close')
        // Or an error
        .merge(Rx.Observable.fromEvent(socket, 'error'))
          // And if I get either of those,
          // I am going to just remove the socket
          // from my rotation
        .do(removeSocket(socket))
    )

  const startServer = (port = 65432) => server.listen(port) &&
    socketStream
      .flatMap(socketObservable)

  return ({
    startServer,
    getId,
    getSocket,
    setSocket,
    socketStream
  })
}