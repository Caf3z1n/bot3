import {
  findPositionByOrderId,
  findPositionByAnyOrderId,
} from '../../database/repositories/positionsRepository.js';
import { fetchUserTrades, fetchOrder } from '../../utils/binanceClient.js';

function extractOrderId(req) {
  const raw =
    req.params?.orderId ?? req.query.order_id ?? req.query.orderId ?? null;
  if (!raw) {
    return '';
  }

  return typeof raw === 'string' ? raw.trim() : String(raw).trim();
}

function formatTrades(trades) {
  return trades.map((trade) => ({
    id: trade.id,
    orderId: String(trade.orderId ?? ''),
    price: trade.price,
    qty: trade.qty,
    realizedPnl: trade.realizedPnl ?? null,
    commission: trade.commission,
    commissionAsset: trade.commissionAsset,
    time: Number.isFinite(Number(trade.time))
      ? new Date(Number(trade.time)).toISOString()
      : null,
    maker: Boolean(trade.maker),
  }));
}

function aggregateFees(trades) {
  return trades.reduce(
    (acc, trade) => {
      const asset = trade.commissionAsset ?? 'UNKNOWN';
      const commission = Number(trade.commission ?? 0);
      if (!Number.isFinite(commission)) {
        return acc;
      }

      acc.total += commission;
      acc.byAsset[asset] = (acc.byAsset[asset] ?? 0) + commission;
      return acc;
    },
    { total: 0, byAsset: {} }
  );
}

function resolveMatchedOrderId(position, matchType) {
  if (matchType === 'tp') {
    return position.tpOrderId;
  }
  if (matchType === 'sl') {
    return position.slOrderId;
  }
  return position.orderId;
}

function buildOrderFetchParams(symbol, rawOrderId) {
  const normalized = String(rawOrderId ?? '').trim();
  if (!normalized) {
    return null;
  }

  const numeric = Number(normalized);
  if (Number.isSafeInteger(numeric)) {
    return { symbol, orderId: numeric };
  }

  return { symbol, orderId: normalized };
}

class PositionDebugController {
  static async fees(req, res) {
    const orderId = extractOrderId(req);

    if (!orderId) {
      return res.status(400).json({
        error: 'Missing order_id. Passe via rota (/.../:orderId) ou query.',
      });
    }

    try {
      const position = await findPositionByOrderId(orderId);
      if (!position) {
        return res.status(404).json({
          error: `Nenhuma position encontrada com order_id ${orderId}`,
        });
      }

      const numericOrderId = Number(position.orderId);
      const tradeParams = {
        symbol: position.symbol,
        ...(Number.isSafeInteger(numericOrderId)
          ? { orderId: numericOrderId }
          : {}),
      };
      const trades = await fetchUserTrades(tradeParams);
      const relevantTrades = Array.isArray(trades)
        ? trades.filter(
            (trade) => String(trade.orderId ?? '') === String(orderId)
          )
        : [];
      const feesSummary = aggregateFees(relevantTrades);

      return res.json({
        orderId: position.orderId,
        symbol: position.symbol,
        position,
        trades: formatTrades(relevantTrades),
        fees: {
          total: feesSummary.total,
          byAsset: feesSummary.byAsset,
        },
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to fetch fees for the given position',
        details: error.message,
      });
    }
  }

  static async order(req, res) {
    const providedOrderId = extractOrderId(req);

    if (!providedOrderId) {
      return res.status(400).json({
        error: 'Missing order_id. Passe via rota (/.../:orderId) ou query.',
      });
    }

    try {
      const { position, matchType } =
        await findPositionByAnyOrderId(providedOrderId);

      if (!position) {
        return res.status(404).json({
          error: `Nenhuma position encontrada com order_id ${providedOrderId}`,
        });
      }

      const effectiveOrderId = resolveMatchedOrderId(position, matchType);
      const params = buildOrderFetchParams(position.symbol, effectiveOrderId);
      if (!params) {
        return res.status(400).json({
          error: 'Identificador da ordem associado à position está vazio.',
        });
      }
      const payload = await fetchOrder(params);

      return res.json({
        symbol: position.symbol,
        orderId: String(effectiveOrderId),
        matchType: matchType ?? 'entry',
        position,
        payload,
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to fetch order details for the given position',
        details: error.message,
      });
    }
  }
}

export default PositionDebugController;
