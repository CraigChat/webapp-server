import dotenv from 'dotenv';
import fastify from 'fastify';
import fastifyHelmet from 'fastify-helmet';
import rateLimit from 'fastify-rate-limit';
import fastifyWebsocket from 'fastify-websocket';

import {
  ConnectionType,
  ConnectionTypeMask,
  DataTypeFlag,
  DataTypeMask,
  EnnuicastrId,
  EnnuicastrParts,
  Feature,
  WebappOp,
  WebappOpCloseReason
} from './protocol';
import { getShardFromConnectionToken, Shard, ShardIdentifyPayload, shardsConnected } from './shards';
import { closeWebsocket, timeoutWebsocket, toBuffer } from './util';

dotenv.config();

// TODO proper logging

const app = fastify({
  logger: process.env.NODE_ENV !== 'production',
  trustProxy: process.env.TRUST_PROXY === 'true',
  ignoreTrailingSlash: true
});

app.register(fastifyWebsocket);
app.register(fastifyHelmet);
app.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  keyGenerator(req) {
    return (req.headers['cf-connecting-ip'] as string) || req.ip;
  },
  errorResponseBuilder() {
    return {
      ok: false,
      error: 'Too many requests'
    };
  }
});

app.addHook('onRequest', async (req, reply) => {
  reply.headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    Connection: 'close'
  });
  return;
});

// Ennuizel Websocket
app.get('/', { websocket: true }, (connection) => {
  timeoutWebsocket(connection.socket);
  connection.socket.once('message', (data) => {
    const message = toBuffer(data);
    if (message.length < EnnuicastrParts.login.length) return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_MESSAGE);
    const cmd: EnnuicastrId = message.readUInt32LE(0);
    if (cmd !== EnnuicastrId.LOGIN) return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_ID);

    const token = message.toString('utf8', EnnuicastrParts.login.token, EnnuicastrParts.login.token + 8);
    const shard = getShardFromConnectionToken(token);
    if (!shard) return closeWebsocket(connection.socket, WebappOpCloseReason.NOT_FOUND);

    try {
      const username = message.toString('utf8', EnnuicastrParts.login.nick).substring(0, 32);
      console.log('User', username, 'connecting to shard', shard.id);
    } catch (ex) {
      return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_USERNAME);
    }

    const flags = message.readUInt32LE(EnnuicastrParts.login.flags);
    const connectionType: ConnectionType = flags & ConnectionTypeMask;
    const dataType: DataTypeFlag = flags & DataTypeMask;
    const isContinuous = !!(flags & Feature.CONTINUOUS);

    if (dataType === DataTypeFlag.FLAC && !shard.payload.flacEnabled) return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_FLAGS);
    if (isContinuous && !shard.payload.continuousEnabled) return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_FLAGS);
    if (![ConnectionType.DATA, ConnectionType.PING, ConnectionType.MONITOR].includes(connectionType))
      return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_CONNECTION_TYPE);

    shard.newConnection(connection.socket, message);

    // And acknowledge them
    const ret = Buffer.alloc(EnnuicastrParts.ack.length);
    ret.writeUInt32LE(EnnuicastrId.ACK, 0);
    ret.writeUInt32LE(EnnuicastrId.LOGIN, EnnuicastrParts.ack.ackd);
    connection.socket.send(ret);
  });
});

// Shard Websocket
app.get('/shard', { websocket: true }, (connection, req) => {
  if (req.headers.authorization !== process.env.SHARD_AUTH) return connection.socket.close();
  timeoutWebsocket(connection.socket);
  connection.socket.once('message', (data) => {
    // Shard will first identify with its information in JSON because lazy
    /**
     * id   json
     * XXXX -> { id: "XXXXXXXXXXXXX", ennuiKey: "XXXXXX", flacEnabled: true, continuousEnabled: true, ... }
     */
    const message = toBuffer(data);
    if (message.length < 16) return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_MESSAGE);
    const cmd: WebappOp = message.readUInt32LE(0);
    if (cmd !== WebappOp.IDENTIFY) return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_MESSAGE);

    const json = message.toString('utf8', 4);
    let payload: ShardIdentifyPayload;
    try {
      payload = JSON.parse(json);
    } catch (e) {
      return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_MESSAGE);
    }

    if (!payload.id || !payload.ennuiKey) return closeWebsocket(connection.socket, WebappOpCloseReason.INVALID_MESSAGE);
    if (shardsConnected.has(payload.id)) return closeWebsocket(connection.socket, WebappOpCloseReason.ALREADY_CONNECTED);

    const shard = new Shard(connection.socket, payload);
    console.log(`Shard ${shard.id} connected (connectionToken=${shard.connectionToken})`, payload);

    // Respond with ready
    const ret = Buffer.alloc(4);
    ret.writeUInt32LE(WebappOp.READY, 0);
    connection.socket.send(ret);
  });
});

// Recording Info Endpoint
app.route({
  method: 'GET',
  url: '/info/:id/:key',
  handler: async (req, reply) => {
    const { id, key } = req.params as Record<string, string>;
    if (!id || !key) return reply.status(400).send({ ok: false, error: 'Invalid id or key' });
    const shard = shardsConnected.get(id);
    if (!shard) return reply.status(404).send({ ok: false, error: 'Recording not found' });
    if (shard.payload.ennuiKey !== key) return reply.status(401).send({ ok: false, error: 'Invalid key' });
    reply.send({
      ok: true,
      recording: {
        connectionToken: shard.connectionToken,
        clientId: shard.payload.clientId,
        clientName: shard.payload.clientName,
        flacEnabled: shard.payload.flacEnabled,
        continuousEnabled: shard.payload.continuousEnabled,
        serverName: shard.payload.serverName,
        serverIcon: shard.payload.serverIcon,
        channelName: shard.payload.channelName,
        channelType: shard.payload.channelType
      }
    });
  }
});

// Health endpoint
app.route({
  method: 'GET',
  url: '/health',
  handler: async (req, reply) => {
    return reply.status(200).send({ ok: true });
  }
});

app.listen(process.env.PORT ? parseInt(process.env.PORT) : 9001, process.env.HOST || 'localhost', (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }

  if (process.send) process.send('ready');
});
