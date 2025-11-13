import { config as loadEnv } from 'dotenv';

loadEnv();

const asList = (value, fallback) => {
  if (!value) return fallback;

  return value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
};

const asInteger = (value, fallback) => {
  if (value === undefined) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const asFloat = (value, fallback) => {
  if (value === undefined) return fallback;

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const asBoolean = (value, fallback) => {
  if (value === undefined) return fallback;

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const strategy = {
  symbols: asList(process.env.BOT2_SYMBOLS),
  interval: process.env.BOT2_INTERVAL,
  emaFastPeriod: asInteger(process.env.BOT2_EMA_FAST),
  emaSlowPeriod: asInteger(process.env.BOT2_EMA_SLOW),
  minimumCandles: asInteger(process.env.BOT2_MIN_CANDLES),
  pullback: {
    penetrationPct: asFloat(process.env.BOT2_PULLBACK_PENETRATION),
  },
  risk: {
    perTradePct: asFloat(process.env.BOT2_RISK_PCT),
    leverage: asFloat(process.env.BOT2_LEVERAGE),
  },
  takeProfitPct: asFloat(process.env.BOT2_TAKE_PROFIT_PCT),
  stopLossPct: asFloat(process.env.BOT2_STOP_LOSS_PCT),
  allowShort: asBoolean(process.env.BOT2_ALLOW_SHORT),
};

const problems = [];

if (!strategy.symbols.length) {
  problems.push('Strategy requires at least one trading symbol.');
}

if (strategy.emaFastPeriod <= 0 || strategy.emaSlowPeriod <= 0) {
  problems.push('EMA periods must be positive integers.');
}

if (strategy.emaFastPeriod >= strategy.emaSlowPeriod) {
  problems.push('EMA fast period must be lower than EMA slow period.');
}

if (strategy.risk.perTradePct <= 0 || strategy.risk.perTradePct > 100) {
  problems.push('Risk per trade must be a percentage between 0 and 100.');
}

if (strategy.takeProfitPct <= 0) {
  problems.push('Take profit percentage must be greater than zero.');
}

if (strategy.stopLossPct <= 0) {
  problems.push('Stop loss percentage must be greater than zero.');
}

if (problems.length) {
  const message = problems.join(' ');
  throw new Error(`[strategy-config] Invalid configuration: ${message}`);
}

export default Object.freeze(strategy);
