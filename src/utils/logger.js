import 'dotenv/config';
import pino from 'pino';

function getBrazilTimestamp() {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false,
  }).format(new Date());
}

const LOG_LEVEL = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
const shouldColorize = true;

const logger = pino({
  level: LOG_LEVEL,
  timestamp: () => `,"time":"${getBrazilTimestamp()}"`,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: shouldColorize,
      ignore: 'pid,hostname',
    },
  },
});

export default logger;
