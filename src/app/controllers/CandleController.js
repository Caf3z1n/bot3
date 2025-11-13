import candlesService, {
  fetchCandles as fetchCandlesWithIndicators,
} from '../../utils/candles.js';
import strategy from '../../config/strategy.js';
import { findAssetBySymbol } from '../../database/repositories/assetRepository.js';

class CandleController {
  static async index(req, res) {
    const requestedSymbol = req.query.symbol?.trim().toUpperCase() ?? null;
    const fallbackSymbol = strategy.symbols?.[0] ?? null;
    const targetSymbol = requestedSymbol || fallbackSymbol;

    if (!targetSymbol) {
      return res.status(400).json({
        error: 'Missing symbol parameter and no default strategy symbol',
      });
    }

    try {
      const asset = await findAssetBySymbol(targetSymbol);
      const limit = Math.max(
        Number(strategy.minimumCandles) || 0,
        Number(asset?.emaSlowPeriod) || 0,
        50
      );
      const candles = await fetchCandlesWithIndicators({
        symbol: targetSymbol,
        interval: strategy.interval,
        limit,
        emaFastPeriod: asset?.emaFastPeriod,
        emaSlowPeriod: asset?.emaSlowPeriod,
      });
      return res.json({ symbol: targetSymbol, candles });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to fetch candles from Binance',
        details: error.message,
      });
    }
  }
}

export default CandleController;
export { candlesService };
