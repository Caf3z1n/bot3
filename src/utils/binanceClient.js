import binanceFactory from 'binance-api-node';

import strategy from '../config/strategy.js';

const createClient = binanceFactory.default ?? binanceFactory;

const parseBoolean = (value) =>
  ['1', 'true', 'yes', 'on'].includes(String(value ?? '').toLowerCase());

const useTestnet = parseBoolean(process.env.BINANCE_USE_TESTNET);
const recvWindow = Number.parseInt(process.env.BINANCE_RECV_WINDOW ?? '', 10);

const clientOptions = {
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  futures: true,
};

if (useTestnet) {
  clientOptions.httpFutures = 'https://testnet.binancefuture.com';
  clientOptions.wsFutures = 'wss://stream.binancefuture.com/ws';
}

const client = createClient(clientOptions);

const DEFAULT_INTERVAL = strategy.interval;
const DEFAULT_LIMIT = Math.max(strategy.minimumCandles ?? 1, 1);

function withRecvWindow(params = {}) {
  if (!Number.isFinite(recvWindow)) {
    return params;
  }
  return { ...params, recvWindow };
}

function normalizeSymbol(symbol) {
  if (typeof symbol !== 'string' || !symbol.trim()) {
    throw new Error('symbol is required');
  }
  return symbol.trim().toUpperCase();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function getClient() {
  // Retorna a instÃ¢ncia configurada do cliente da Binance (Ãºtil para chamadas diretas).
  return client;
}

export async function syncTime() {
  // Ajusta o offset local com base no horÃ¡rio do servidor para evitar erros de timestamp.
  const serverTime = await client.time();
  const offset = serverTime - Date.now();
  client.timeOffset = offset;
  return offset;
}

export async function fetchRecentKlines(
  symbol,
  interval = DEFAULT_INTERVAL,
  options = {}
) {
  // Busca candles recentes do par informado respeitando intervalo e limite definidos na estratÃ©gia.
  const limit = clamp(options?.limit ?? DEFAULT_LIMIT, 1, 1500);
  const payload = withRecvWindow({
    symbol: normalizeSymbol(symbol),
    interval,
    limit,
  });
  return client.futuresCandles(payload);
}

export async function fetchMarkPrice(symbol) {
  // Recupera o mark price atual de um sÃ­mbolo futuro.
  const payload = withRecvWindow({ symbol: normalizeSymbol(symbol) });
  return client.futuresMarkPrice(payload);
}

export async function fetchAccountBalance() {
  // Lista saldos futuros (margin) da conta configurada.
  return client.futuresAccountBalance(withRecvWindow());
}

export async function fetchPositions(params = {}) {
  // ObtÃ©m o risco/posiÃ§Ã£o atual para todos os sÃ­mbolos configurados.
  return client.futuresPositionRisk(withRecvWindow(params));
}

export async function fetchPositionMode() {
  // Verifica se a conta estÃ¡ em modo hedge ou single via Binance Futures.
  return client.futuresPositionMode(withRecvWindow());
}

export async function placeOrder(params) {
  // Envia uma ordem de futuros (market/limit/stop) para o sÃ­mbolo informado.
  const { symbol, ...rest } = params || {};
  if (!symbol) {
    throw new Error('placeOrder requires a symbol');
  }
  const payload = withRecvWindow({
    symbol: normalizeSymbol(symbol),
    ...rest,
  });
  return client.futuresOrder(payload);
}

export async function cancelOrder(params) {
  // Cancela uma ordem aberta de futuros identificada por sÃ­mbolo e dados extras.
  const { symbol, ...rest } = params || {};
  if (!symbol) {
    throw new Error('cancelOrder requires a symbol');
  }
  const payload = withRecvWindow({
    symbol: normalizeSymbol(symbol),
    ...rest,
  });
  return client.futuresCancelOrder(payload);
}

export async function cancelAllOpenOrders(params) {
  // Cancela todas as ordens abertas (nÃ£o executadas) de um sÃ­mbolo futuro.
  const { symbol } = params || {};
  if (!symbol) {
    throw new Error('cancelAllOpenOrders requires a symbol');
  }
  const payload = withRecvWindow({
    symbol: normalizeSymbol(symbol),
  });
  return client.futuresCancelAllOpenOrders(payload);
}

export async function fetchOrder(params) {
  // Recupera detalhes de uma ordem especÃ­fica no mercado de futuros.
  const { symbol, ...rest } = params || {};
  if (!symbol) {
    throw new Error('fetchOrder requires a symbol');
  }
  const payload = withRecvWindow({
    symbol: normalizeSymbol(symbol),
    ...rest,
  });
  return client.futuresGetOrder(payload);
}

export async function fetchUserTrades(params = {}) {
  // Lista execuÃ§Ãµes (fills) do usuÃ¡rio, opcionalmente filtrando por sÃ­mbolo e tempo.
  const { symbol, ...rest } = params;
  const payload = withRecvWindow({
    ...rest,
    ...(symbol ? { symbol: normalizeSymbol(symbol) } : {}),
  });
  return client.futuresUserTrades(payload);
}

export async function fetchOpenOrders(params = {}) {
  const { symbol, ...rest } = params || {};
  const payload = withRecvWindow({
    ...rest,
    ...(symbol ? { symbol: normalizeSymbol(symbol) } : {}),
  });
  return client.futuresOpenOrders(payload);
}

export async function setLeverage(params) {
  // Ajusta a alavancagem desejada para um sÃ­mbolo de futuros.
  const { symbol, leverage } = params || {};
  if (!symbol) {
    throw new Error('setLeverage requires a symbol');
  }
  const payload = withRecvWindow({
    symbol: normalizeSymbol(symbol),
    leverage,
  });
  return client.futuresLeverage(payload);
}

export async function fetchExchangeInfo() {
  return client.futuresExchangeInfo();
}

export async function fetchLeverageBrackets(params) {
  return client.futuresLeverageBracket(withRecvWindow(params ?? {}));
}

const binanceClient = {
  getClient,
  syncTime,
  fetchRecentKlines,
  fetchMarkPrice,
  fetchAccountBalance,
  fetchPositions,
  fetchPositionMode,
  fetchUserTrades,
  fetchOpenOrders,
  placeOrder,
  cancelOrder,
  cancelAllOpenOrders,
  fetchOrder,
  setLeverage,
  fetchExchangeInfo,
  fetchLeverageBrackets,
};

export default binanceClient;

