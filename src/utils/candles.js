import { format } from 'date-fns';
import { EMA } from 'technicalindicators';

import strategy from '../config/strategy.js';
import { fetchRecentKlines } from './binanceClient.js';

const DEFAULT_INTERVAL = strategy.interval;
const DEFAULT_LIMIT = Math.max(Number(strategy.minimumCandles) || 1, 50);

function resolvePositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }

  return Math.trunc(numeric);
}

function resolveLimit(value, fastPeriod, slowPeriod) {
  const base = resolvePositiveInteger(value, DEFAULT_LIMIT);
  const candidates = [
    base,
    Number(strategy.minimumCandles) || 0,
    slowPeriod || 0,
    fastPeriod || 0,
  ].filter((item) => Number.isFinite(item) && item > 0);

  return Math.max(...candidates, base, 1);
}

/**
 * @typedef {Object} CandleWithIndicators
 * @property {string} openTime
 * @property {string} closeTime
 * @property {number} openTimeMs
 * @property {number} closeTimeMs
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume
 * @property {number|null} emaFast
 * @property {number|null} emaSlow
 */

function assignIndicatorSeries(bars, series, key) {
  if (!Array.isArray(series) || series.length === 0) return;
  const offset = bars.length - series.length;
  series.forEach((value, index) => {
    const bar = bars[index + offset];
    if (!bar) return;
    const numeric = Number.parseFloat(value);
    bar[key] = Number.isFinite(numeric) ? Number(numeric.toFixed(8)) : null;
  });
}

/**
 * Recupera candles do símbolo informado e enriquece com EMA rápida/lenta.
 * @param {{
 *   symbol: string,
 *   interval?: string,
 *   limit?: number,
 *   emaFastPeriod?: number,
 *   emaSlowPeriod?: number
 * }} params
 * @returns {Promise<CandleWithIndicators[]>}
 */
export async function fetchCandles({
  symbol,
  interval = DEFAULT_INTERVAL,
  limit = DEFAULT_LIMIT,
  emaFastPeriod,
  emaSlowPeriod,
} = {}) {
  if (!symbol) {
    throw new Error('symbol is required');
  }

  const fastPeriod = resolvePositiveInteger(
    emaFastPeriod,
    strategy.emaFastPeriod
  );
  const slowPeriod = resolvePositiveInteger(
    emaSlowPeriod,
    strategy.emaSlowPeriod
  );

  const effectiveLimit = resolveLimit(limit, fastPeriod, slowPeriod);

  const rawCandles = await fetchRecentKlines(symbol, interval, {
    limit: effectiveLimit,
  });
  if (!rawCandles.length) {
    return [];
  }

  const bars = rawCandles.map((candle) => ({
    openTime: format(new Date(candle.openTime), 'dd/MM/yyyy HH:mm'),
    closeTime: format(new Date(candle.closeTime), 'dd/MM/yyyy HH:mm'),
    openTimeMs: Number(candle.openTime),
    closeTimeMs: Number(candle.closeTime),
    open: Number.parseFloat(candle.open),
    high: Number.parseFloat(candle.high),
    low: Number.parseFloat(candle.low),
    close: Number.parseFloat(candle.close),
    volume: Number.parseFloat(candle.volume),
    emaFast: null,
    emaSlow: null,
  }));

  const closes = bars.map((bar) => bar.close);

  const emaFastSeries =
    Number.isFinite(fastPeriod) && fastPeriod > 0 && closes.length >= fastPeriod
      ? EMA.calculate({ period: fastPeriod, values: closes })
      : [];
  assignIndicatorSeries(bars, emaFastSeries, 'emaFast');

  const emaSlowSeries =
    Number.isFinite(slowPeriod) && slowPeriod > 0 && closes.length >= slowPeriod
      ? EMA.calculate({ period: slowPeriod, values: closes })
      : [];
  assignIndicatorSeries(bars, emaSlowSeries, 'emaSlow');

  return bars.reverse();
}

export default {
  fetchCandles,
};
