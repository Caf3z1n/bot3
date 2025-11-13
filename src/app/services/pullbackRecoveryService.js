import loggerFactory from '../../utils/logger.js';
import Asset from '../../database/models/Asset.js';
import {
  listAssetsByStatus,
  updateAssetOrderId,
  updateAssetTriggerPrice,
} from '../../database/repositories/assetRepository.js';
import { fetchOpenOrders } from '../../utils/binanceClient.js';
import { openOrdersForTriggerAssets } from './assetOpenOrderService.js';
import strategy from '../../config/strategy.js';

const STATUS_AWAITING_PULLBACK = Asset.Status.AWAITING_PULLBACK;
const SIDE_LONG = Asset.Side.LONG;
const SIDE_SHORT = Asset.Side.SHORT;

const DEFAULT_PENETRATION_VALUE = Number(
  strategy?.pullback?.penetrationPct ?? 0
);
const DEFAULT_PENETRATION_FRACTION = Number.isFinite(DEFAULT_PENETRATION_VALUE)
  ? DEFAULT_PENETRATION_VALUE / 100
  : 0;

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeOrderId(order) {
  if (!order) {
    return null;
  }

  const id = order.orderId ?? order.clientOrderId ?? null;
  if (!id) {
    return null;
  }

  const normalized = String(id).trim();
  return normalized.length > 0 ? normalized : null;
}

function snapPrice(rawPrice, tickSize, side) {
  const step = tickSize > 0 ? tickSize : 1;

  if (side === SIDE_LONG) {
    return Math.ceil(rawPrice / step - Number.EPSILON) * step;
  }

  return Math.floor(rawPrice / step + Number.EPSILON) * step;
}

function findMatchingOpenOrder(openOrders, asset) {
  if (!Array.isArray(openOrders) || openOrders.length === 0) {
    return null;
  }

  const expectedSide = asset.side === SIDE_SHORT ? 'SELL' : 'BUY';

  return (
    openOrders.find((order) => {
      if (!order) {
        return false;
      }

      const sameSymbol = order.symbol === asset.symbol;
      const sameSide = order.side === expectedSide;
      const samePositionSide =
        !order.positionSide ||
        order.positionSide === 'BOTH' ||
        (asset.side === SIDE_LONG && order.positionSide === 'LONG') ||
        (asset.side === SIDE_SHORT && order.positionSide === 'SHORT');

      return sameSymbol && sameSide && samePositionSide;
    }) ?? null
  );
}

function resolvePenetrationFraction(asset) {
  const value = Number(asset?.pullbackPenetrationPct);
  if (Number.isFinite(value)) {
    return value / 100;
  }
  return DEFAULT_PENETRATION_FRACTION;
}

function resolvePullbackMultiplier(side, asset) {
  if (!side) {
    return null;
  }
  const fraction = resolvePenetrationFraction(asset);
  if (side === SIDE_LONG) {
    return 1 - fraction;
  }
  if (side === SIDE_SHORT) {
    return 1 + fraction;
  }
  return null;
}

/**
 * Recupera ativos awaiting_pullback sem triggerPrice/orderId e tenta popular valores faltantes.
 * @param {{ logger?: import('pino').Logger }} [options]
 */
export async function recoverPullbackAssets(options = {}) {
  const baseLogger = options.logger ?? loggerFactory;
  const log =
    typeof baseLogger.child === 'function'
      ? baseLogger.child({ contexto: 'pullback-recovery' })
      : baseLogger;

  const assets = await listAssetsByStatus(STATUS_AWAITING_PULLBACK);
  if (assets.length === 0) {
    return {
      processed: 0,
      triggersUpdated: 0,
      ordersRecovered: 0,
      ordersCreated: 0,
    };
  }

  let triggersUpdated = 0;
  let ordersRecovered = 0;
  let needsOrderCreation = false;
  let processed = 0;

  for (const asset of assets) {
    const triggerPrice = toNumber(asset.triggerPrice);
    const hasTrigger = triggerPrice != null;
    const rawOrderId = asset.orderId ? String(asset.orderId).trim() : '';
    const hasOrderId = rawOrderId !== '';

    if (hasTrigger && hasOrderId) {
      // Nada a fazer para este ativo.
      // eslint-disable-next-line no-continue
      continue;
    }

    processed += 1;

    if (!hasTrigger) {
      const emaFast1 = toNumber(asset.emaFast1);
      const tickSize = toNumber(asset.tickSize);
      const multiplier = resolvePullbackMultiplier(asset.side, asset);

      if (
        !Number.isFinite(emaFast1) ||
        !Number.isFinite(tickSize) ||
        !Number.isFinite(multiplier)
      ) {
        log.warn(
          {
            symbol: asset.symbol,
            emaFast1,
            tickSize,
            side: asset.side,
          },
          '[PullbackRecovery] Dados insuficientes para recalcular trigger'
        );
      } else {
        const raw = emaFast1 * multiplier;
        const snapped = snapPrice(raw, tickSize, asset.side);
        const computed = Number(snapped.toFixed(8));

        await updateAssetTriggerPrice(asset.symbol, computed);
        triggersUpdated += 1;

        log.info(
          {
            symbol: asset.symbol,
            triggerPrice: computed,
            side: asset.side,
          },
          '[PullbackRecovery] Trigger_price recomposto com sucesso'
        );
      }
    }

    if (!hasOrderId) {
      try {
        const openOrders = await fetchOpenOrders({ symbol: asset.symbol });
        const matching = findMatchingOpenOrder(openOrders, asset);

        if (matching) {
          const normalizedId = normalizeOrderId(matching);
          if (normalizedId) {
            await updateAssetOrderId(asset.symbol, normalizedId);
            ordersRecovered += 1;

            log.info(
              {
                symbol: asset.symbol,
                orderId: normalizedId,
              },
              '[PullbackRecovery] orderId recuperado a partir da Binance'
            );
            // eslint-disable-next-line no-continue
            continue;
          }
        }
      } catch (error) {
        log.warn(
          { symbol: asset.symbol, err: error },
          '[PullbackRecovery] Falha ao consultar ordens abertas para reconciliacao'
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      // Se chegamos aqui ainda estamos sem orderId; precisamos criar uma nova ordem.
      needsOrderCreation = true;
    }
  }

  let ordersCreated = 0;
  if (needsOrderCreation) {
    const created = await openOrdersForTriggerAssets({ logger: log });
    ordersCreated = Array.isArray(created) ? created.length : 0;
  }

  return {
    processed,
    triggersUpdated,
    ordersRecovered,
    ordersCreated,
  };
}

export default {
  recoverPullbackAssets,
};
