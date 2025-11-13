import type { CandleWithIndicators } from './candles.js';

declare module './candles.js' {
  export interface CandleWithIndicators {
    openTime: string;
    closeTime: string;
    openTimeMs: number;
    closeTimeMs: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    emaFast: number | null;
    emaSlow: number | null;
  }

  export function fetchCandles(options: {
    symbol: string;
    interval?: string;
    limit?: number;
  }): Promise<CandleWithIndicators[]>;
}
