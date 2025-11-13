import loggerFactory from '../../utils/logger.js';
import Position from '../../database/models/Position.js';
import {
  listPositions,
  updatePosition,
} from '../../database/repositories/positionsRepository.js';
import { listAssets } from '../../database/repositories/assetRepository.js';
import { placeOrder, fetchPositionMode } from '../../utils/binanceClient.js';
import strategy from '../../config/strategy.js';

const STATUS_OPEN = Position.Status.OPEN;
const SIDE_SHORT = Position.Side.SHORT;

function normalizeFractionValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric / 100;
}

const DEFAULT_TAKE_PROFIT_FRACTION = normalizeFractionValue(
  strategy?.takeProfitPct
);
const DEFAULT_STOP_LOSS_FRACTION = normalizeFractionValue(
  strategy?.stopLossPct
);

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function snapPrice(value, tickSize, mode = 'nearest') {
  const price = toNumber(value);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  const step = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 0.01;
  const ratio = price / step;

  let snapped;
  if (mode === 'up') {
    snapped = Math.ceil(ratio - Number.EPSILON) * step;
  } else if (mode === 'down') {
    snapped = Math.floor(ratio + Number.EPSILON) * step;
  } else {
    snapped = Math.round(ratio) * step;
  }

  return Number(snapped.toFixed(8));
}

function formatDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(8) : null;
}

function computeTargets(positionPrice, isShort, fractions) {
  const entryPrice = toNumber(positionPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { tp: null, sl: null };
  }

  const tpMultiplier = isShort
    ? 1 - fractions.takeProfitFraction
    : 1 + fractions.takeProfitFraction;
  const slMultiplier = isShort
    ? 1 + fractions.stopLossFraction
    : 1 - fractions.stopLossFraction;

  const takeProfit = entryPrice * tpMultiplier;
  const stopLoss = entryPrice * slMultiplier;

  return {
    tp: Number(takeProfit.toFixed(8)),
    sl: Number(stopLoss.toFixed(8)),
  };
}

function buildTakeProfitPayload({ position, stopPrice, hedgeMode }) {
  const isShort = position.side === SIDE_SHORT;
  const payload = {
    symbol: position.symbol,
    side: isShort ? 'BUY' : 'SELL',
    type: 'TAKE_PROFIT_MARKET',
    closePosition: 'true',
    stopPrice: formatDecimal(stopPrice),
  };

  if (hedgeMode) {
    payload.positionSide = isShort ? 'SHORT' : 'LONG';
  }

  return payload;
}

function buildStopPayload({ position, stopPrice, hedgeMode }) {
  const isShort = position.side === SIDE_SHORT;
  const payload = {
    symbol: position.symbol,
    side: isShort ? 'BUY' : 'SELL',
    type: 'STOP_MARKET',
    closePosition: 'true',
    stopPrice: formatDecimal(stopPrice),
  };

  if (hedgeMode) {
    payload.positionSide = isShort ? 'SHORT' : 'LONG';
  }

  return payload;
}

export async function ensureTpSlOrdersForPositions(options = {}) {
  if (
    !Number.isFinite(DEFAULT_TAKE_PROFIT_FRACTION) ||
    !Number.isFinite(DEFAULT_STOP_LOSS_FRACTION)
  ) {
    throw new Error(
      '[position-exit] Take profit e stop loss precisam ser maiores que zero'
    );
  }

  const baseLogger = options.logger ?? loggerFactory;
  const log =
    typeof baseLogger?.child === 'function'
      ? baseLogger.child({ contexto: 'position-exit-orders' })
      : baseLogger;

  const [positions, assets, positionMode] = await Promise.all([
    listPositions({ status: STATUS_OPEN }),
    listAssets(),
    fetchPositionMode().catch((error) => {
      log.warn(
        { err: error },
        '[PositionExit] Falha ao obter position mode; assumindo one-way'
      );
      return null;
    }),
  ]);

  const hedgeMode = Boolean(positionMode?.dualSidePosition);
  const assetMap = new Map(assets.map((asset) => [asset.symbol, asset]));

  const pendingPositions = positions.filter(
    (position) => !position.tpOrderId || !position.slOrderId
  );

  if (pendingPositions.length === 0) {
    log.debug('[PositionExit] Nenhuma position pendente de TP/SL');
    return { processed: 0, tpCreated: 0, slCreated: 0 };
  }

  let tpCreated = 0;
  let slCreated = 0;

  for (const position of pendingPositions) {
    const asset = assetMap.get(position.symbol);
    if (!asset) {
      log.warn(
        { symbol: position.symbol },
        '[PositionExit] Asset nao encontrado para position; pulando'
      );
      // eslint-disable-next-line no-continue
      continue;
    }

    const tickSize = toNumber(asset.tickSize);
    const takeProfitFraction =
      normalizeFractionValue(asset.takeProfitPct) ??
      DEFAULT_TAKE_PROFIT_FRACTION;
    const stopLossFraction =
      normalizeFractionValue(asset.stopLossPct) ?? DEFAULT_STOP_LOSS_FRACTION;

    if (
      !Number.isFinite(takeProfitFraction) ||
      !Number.isFinite(stopLossFraction)
    ) {
      log.warn(
        { symbol: position.symbol },
        '[PositionExit] Percentual de TP/SL invalido; pulando position'
      );
      // eslint-disable-next-line no-continue
      continue;
    }

    const isShort = position.side === SIDE_SHORT;
    const targets = computeTargets(position.price, isShort, {
      takeProfitFraction,
      stopLossFraction,
    });

    if (!Number.isFinite(targets.tp) || !Number.isFinite(targets.sl)) {
      log.warn(
        { positionId: position.id, price: position.price },
        '[PositionExit] Preco base invalido; pulando position'
      );
      // eslint-disable-next-line no-continue
      continue;
    }

    const updates = {};

    if (!position.tpOrderId) {
      const snappedTp = snapPrice(
        targets.tp,
        tickSize,
        isShort ? 'down' : 'up'
      );

      if (!Number.isFinite(snappedTp) || snappedTp <= 0) {
        log.warn(
          { positionId: position.id, tpTarget: targets.tp },
          '[PositionExit] Falha ao ajustar TP pelo tick size'
        );
      } else {
        try {
          const payload = buildTakeProfitPayload({
            position,
            stopPrice: snappedTp,
            hedgeMode,
          });
          const response = await placeOrder(payload);
          const orderId = response?.orderId ?? response?.clientOrderId ?? null;

          if (!orderId) {
            throw new Error('Resposta sem orderId');
          }

          updates.tpOrderId = String(orderId);
          updates.tpPrice = snappedTp;
          tpCreated += 1;

          log.info(
            {
              positionId: position.id,
              orderId,
              price: snappedTp,
            },
            '[PositionExit] Ordem de take-profit criada'
          );
        } catch (error) {
          log.error(
            { positionId: position.id, err: error },
            '[PositionExit] Falha ao criar ordem de take-profit'
          );
        }
      }
    }

    if (!position.slOrderId) {
      const snappedSl = snapPrice(
        targets.sl,
        tickSize,
        isShort ? 'up' : 'down'
      );

      if (!Number.isFinite(snappedSl) || snappedSl <= 0) {
        log.warn(
          { positionId: position.id, slTarget: targets.sl },
          '[PositionExit] Falha ao ajustar SL pelo tick size'
        );
      } else {
        const invalidRange =
          (!isShort && snappedSl >= toNumber(position.price)) ||
          (isShort && snappedSl <= toNumber(position.price));
        if (invalidRange) {
          log.warn(
            {
              positionId: position.id,
              entryPrice: position.price,
              snappedSl,
              side: position.side,
            },
            '[PositionExit] Stop loss ficou do mesmo lado do preco de entrada; pulando'
          );
        } else {
          try {
            const payload = buildStopPayload({
              position,
              stopPrice: snappedSl,
              hedgeMode,
            });
            const response = await placeOrder(payload);
            const orderId =
              response?.orderId ?? response?.clientOrderId ?? null;

            if (!orderId) {
              throw new Error('Resposta sem orderId');
            }

            updates.slOrderId = String(orderId);
            updates.slPrice = snappedSl;
            slCreated += 1;

            log.info(
              {
                positionId: position.id,
                orderId,
                price: snappedSl,
              },
              '[PositionExit] Ordem de stop-loss criada'
            );
          } catch (error) {
            log.error(
              { positionId: position.id, err: error },
              '[PositionExit] Falha ao criar ordem de stop-loss'
            );
          }
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        await updatePosition(position.id, updates);
      } catch (error) {
        log.error(
          { positionId: position.id, updates, err: error },
          '[PositionExit] Falha ao atualizar registro da position'
        );
      }
    }
  }

  return {
    processed: pendingPositions.length,
    tpCreated,
    slCreated,
  };
}

export default {
  ensureTpSlOrdersForPositions,
};
