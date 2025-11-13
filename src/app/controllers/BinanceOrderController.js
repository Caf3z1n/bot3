import {
  cancelAllOpenOrders,
  fetchOrder,
  fetchOpenOrders,
} from '../../utils/binanceClient.js';
import { findAssetByOrderId } from '../../database/repositories/assetRepository.js';

class BinanceOrderController {
  static async listOpen(req, res) {
    const rawSymbol =
      typeof req.query.symbol === 'string' ? req.query.symbol : '';
    const symbol = rawSymbol.trim().toUpperCase();

    try {
      const payload = await fetchOpenOrders(symbol ? { symbol } : {});
      const orders = Array.isArray(payload)
        ? payload.filter(
            (order) =>
              String(order?.status ?? '')
                .trim()
                .toUpperCase() === 'NEW'
          )
        : [];

      return res.json({
        ...(symbol ? { symbol } : {}),
        orders,
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to fetch open orders on Binance',
        details: error.message,
      });
    }
  }

  static async cancelOpen(req, res) {
    const symbol = req.query.symbol?.trim().toUpperCase() ?? null;

    if (!symbol) {
      return res.status(400).json({
        error: 'Missing symbol query parameter (e.g., ?symbol=BTCUSDT)',
      });
    }

    try {
      const payload = await cancelAllOpenOrders({ symbol });
      return res.json({ symbol, payload });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to cancel open orders on Binance',
        details: error.message,
      });
    }
  }

  static async show(req, res) {
    const rawOrderId =
      req.query.order_id ?? req.query.orderId ?? req.params?.orderId;
    const orderId =
      typeof rawOrderId === 'string'
        ? rawOrderId.trim()
        : String(rawOrderId ?? '').trim();

    if (!orderId) {
      return res.status(400).json({
        error:
          'Missing order_id. Informe via query (?order_id=123) ou parametro de rota.',
      });
    }

    try {
      const asset = await findAssetByOrderId(orderId);
      if (!asset) {
        return res.status(404).json({
          error: `Nenhum asset encontrado com order_id ${orderId}`,
        });
      }

      const payload = await fetchOrder({ symbol: asset.symbol, orderId });
      return res.json({
        symbol: asset.symbol,
        orderId,
        payload,
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to fetch order details on Binance',
        details: error.message,
      });
    }
  }
}

export default BinanceOrderController;
