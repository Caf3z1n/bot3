import { config as loadEnv } from 'dotenv';

loadEnv();

const asBoolean = (value, fallback) => {
  if (value === undefined) return fallback;

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const asInteger = (value, fallback) => {
  if (value === undefined) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const TESTNET_FUTURES_URL = 'https://testnet.binancefuture.com';
const PRODUCTION_FUTURES_URL = 'https://fapi.binance.com';

const useTestnet = asBoolean(process.env.BINANCE_USE_TESTNET, true);

const binanceConfig = {
  apiKey: process.env.BINANCE_API_KEY ?? '',
  apiSecret: process.env.BINANCE_API_SECRET ?? '',
  useTestnet,
  futuresBaseUrl:
    process.env.BINANCE_FUTURES_BASE_URL ||
    (useTestnet ? TESTNET_FUTURES_URL : PRODUCTION_FUTURES_URL),
  recvWindow: asInteger(process.env.BINANCE_RECV_WINDOW, 5000),
};

export function validateBinanceConfig({ allowEmpty = false } = {}) {
  const issues = [];

  if (!allowEmpty) {
    if (
      !binanceConfig.apiKey ||
      binanceConfig.apiKey === 'YOUR_BINANCE_API_KEY'
    ) {
      issues.push('Set BINANCE_API_KEY in your environment.');
    }

    if (
      !binanceConfig.apiSecret ||
      binanceConfig.apiSecret === 'YOUR_BINANCE_API_SECRET'
    ) {
      issues.push('Set BINANCE_API_SECRET in your environment.');
    }
  }

  if (binanceConfig.recvWindow <= 0) {
    issues.push('BINANCE_RECV_WINDOW must be a positive integer.');
  }

  if (issues.length) {
    throw new Error(`[binance-config] ${issues.join(' ')}`);
  }
}

export default Object.freeze(binanceConfig);
