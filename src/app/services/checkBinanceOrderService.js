import loggerFactory from '../../utils/logger.js';
import Asset from '../../database/models/Asset.js';
import {
  listAssetsByStatus,
  updateAssetState,
} from '../../database/repositories/assetRepository.js';
import { createPosition } from '../../database/repositories/positionsRepository.js';
import { fetchOrder, fetchUserTrades } from '../../utils/binanceClient.js';

const STATUS_AWAITING_PULLBACK = Asset.Status.AWAITING_PULLBACK;
const STATUS_IN_POSITION = Asset.Status.IN_POSITION;

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveOrderFetchParams(asset) {
  const normalizedOrderId = String(asset.orderId ?? '').trim();
  if (!normalizedOrderId) {
    return null;
  }

  const numericOrderId = Number(normalizedOrderId);
  if (Number.isSafeInteger(numericOrderId)) {
    return {
      symbol: asset.symbol,
      orderId: numericOrderId,
    };
  }

  return {
    symbol: asset.symbol,
    orderId: normalizedOrderId,
  };
}

function buildPositionPayload(asset, order, totalFees) {
  const avgPrice = toNumber(order?.avgPrice ?? order?.price);
  const executedQty = toNumber(order?.executedQty ?? order?.origQty);
  const notional =
    toNumber(order?.cumQuote) ??
    (avgPrice != null && executedQty != null
      ? Number((avgPrice * executedQty).toFixed(8))
      : null);

  return {
    symbol: asset.symbol,
    side: asset.side,
    orderId: String(order?.orderId ?? order?.clientOrderId ?? asset.orderId),
    candleCrossTime: asset.candleCrossTime
      ? new Date(asset.candleCrossTime)
      : null,
    fees:
      totalFees != null && Number.isFinite(totalFees)
        ? Number(totalFees.toFixed(8))
        : null,
    price: avgPrice,
    notional,
    qty: executedQty,
    exitTime: null,
    pnl: null,
  };
}

export async function checkBinanceOrders(options = {}) {
  const baseLogger = options.logger ?? loggerFactory;
  const log =
    typeof baseLogger?.child === 'function'
      ? baseLogger.child({ contexto: 'check-binance-order' })
      : baseLogger;

  const assetsAwaiting = await listAssetsByStatus(STATUS_AWAITING_PULLBACK);
  const assetsWithOrder = assetsAwaiting.filter(
    (asset) => asset.orderId && String(asset.orderId).trim().length > 0
  );

  if (assetsWithOrder.length === 0) {
    log.debug('[CheckOrder] Nenhum asset aguardando pullback com orderId');
    return { processed: 0, filled: 0 };
  }

  let processed = 0;
  let filled = 0;

  for (const asset of assetsWithOrder) {
    processed += 1;

    try {
      const orderParams = resolveOrderFetchParams(asset);
      if (!orderParams) {
        log.warn(
          { symbol: asset.symbol, orderId: asset.orderId },
          '[CheckOrder] Ordem sem identificador valido; ignorando'
        );
        // eslint-disable-next-line no-continue
        continue;
      }
      const order = await fetchOrder(orderParams);

      if (!order || order.status !== 'FILLED') {
        log.debug(
          {
            symbol: asset.symbol,
            orderId: asset.orderId,
            status: order?.status ?? 'UNKNOWN',
          },
          '[CheckOrder] Ordem ainda nao preenchida'
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      const canonicalOrderId =
        order?.orderId ?? order?.clientOrderId ?? asset.orderId;
      let totalFees = null;

      try {
        const numericOrderId = Number(canonicalOrderId);
        const includeOrderId = Number.isSafeInteger(numericOrderId);
        const tradeParams = {
          symbol: asset.symbol,
          ...(includeOrderId ? { orderId: numericOrderId } : {}),
        };
        const trades = await fetchUserTrades(tradeParams);
        if (Array.isArray(trades) && trades.length > 0) {
          let matches = 0;
          const sum = trades.reduce((acc, trade) => {
            if (String(trade.orderId ?? '') !== String(canonicalOrderId)) {
              return acc;
            }

            const commission = Number(trade.commission ?? 0);
            if (!Number.isFinite(commission)) {
              return acc;
            }

            matches += 1;
            return acc + commission;
          }, 0);

          if (matches > 0) {
            totalFees = sum;
          }
        }
      } catch (tradeError) {
        log.warn(
          { symbol: asset.symbol, orderId: canonicalOrderId, err: tradeError },
          '[CheckOrder] Nao foi possivel recuperar fees da Binance'
        );
      }

      const positionPayload = buildPositionPayload(asset, order, totalFees);
      await createPosition(positionPayload);
      await updateAssetState(asset.symbol, {
        status: STATUS_IN_POSITION,
      });

      filled += 1;
      log.info(
        {
          symbol: asset.symbol,
          orderId: positionPayload.orderId,
          price: positionPayload.price,
          qty: positionPayload.qty,
        },
        '[CheckOrder] Ordem FILLED processada; position criada'
      );
    } catch (error) {
      log.error(
        { symbol: asset.symbol, orderId: asset.orderId, err: error },
        '[CheckOrder] Falha ao verificar ordem na Binance'
      );
    }
  }

  return { processed, filled };
}

export default {
  checkBinanceOrders,
};
