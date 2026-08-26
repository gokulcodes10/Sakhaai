import pino from 'pino';
import config from '../config/index.js';

export const logger = pino({
  level: config.log.level,
  ...(config.log.pretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.newPassword',
      'req.body.currentPassword',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
});

export default logger;
