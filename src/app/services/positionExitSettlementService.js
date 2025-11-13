/* eslint-disable no-continue */
/* eslint-disable no-nested-ternary */
import loggerFactory from '../../utils/logger.js';
import Position from '../../database/models/Position.js';
import Asset from '../../database/models/Asset.js';
import {
  listPositions,
  updatePosition,
} from '../../database/repositories/positionsRepository.js';
import {
  updateAssetState,
  updateAssetTriggerPrice,
} from '../../database/repositories/assetRepository.js';
import {
  cancelOrder,
  fetchOrder,
  fetchUserTrades,
} from '../../utils/binanceClient.js';

const STATUS_OPEN = Position.Status.OPEN;
const STATUS_CLOSED = Position.Status.CLOSED;
const SIDE_SHORT = Position.Side.SHORT;
const STATUS_AWAITING_CROSS = Asset.Status.AWAITING_CROSS;

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildOrderLookupParams(symbol, rawOrderId) {
  if (!rawOrderId) {
    return null;
  }
  const normalizedId = String(rawOrderId).trim();
  if (!normalizedId) {
    return null;
  }
  const numericId = Number(normalizedId);
  if (Number.isSafeInteger(numericId)) {
    return { symbol, orderId: numericId };
  }
  return { symbol, orderId: normalizedId };
}

async function fetchOrderStatus(position, orderId, log) {
  const params = buildOrderLookupParams(position.symbol, orderId);
  if (!params) {
    return null;
  }

  try {
    return await fetchOrder(params);
  } catch (error) {
    log.error(
      { positionId: position.id, symbol: position.symbol, orderId, err: error },
      '[PositionSettlement] Falha ao consultar status da ordem'
    );
    return null;
  }
}

async function fetchTradesForOrder(symbol, order) {
  if (!order) {
    return [];
  }

  const canonicalId = order.orderId ?? order.clientOrderId;
  const numericId = Number(canonicalId);
  let trades = [];

  if (Number.isSafeInteger(numericId)) {
    trades = await fetchUserTrades({ symbol, orderId: numericId });
  } else {
    trades = await fetchUserTrades({ symbol });
  }

  if (!Array.isArray(trades)) {
    return [];
  }

  return trades.filter(
    (trade) => String(trade.orderId ?? '') === String(canonicalId ?? '')
  );
}

function aggregateTradeStats(trades) {
  return trades.reduce(
    (acc, trade) => {
      const fee = toNumber(trade.commission);
      if (Number.isFinite(fee)) {
        acc.fees += fee;
      }

      const realized = toNumber(trade.realizedPnl);
      if (Number.isFinite(realized)) {
        acc.realizedPnl += realized;
      }

      const qty = toNumber(trade.qty ?? trade.quantity);
      const price = toNumber(trade.price);
      if (Number.isFinite(qty) && Number.isFinite(price)) {
        acc.totalQty += qty;
        acc.totalNotional += qty * price;
      }

      const time = Number(trade.time);
      if (Number.isFinite(time) && time > acc.lastTradeTime) {
        acc.lastTradeTime = time;
      }

      return acc;
    },
    { fees: 0, realizedPnl: 0, totalQty: 0, totalNotional: 0, lastTradeTime: 0 }
  );
}

function computeDirectionalPnl({ side, entryPrice, exitPrice, qty }) {
  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(exitPrice) ||
    !Number.isFinite(qty)
  ) {
    return null;
  }

  const delta =
    side === SIDE_SHORT
      ? (entryPrice - exitPrice) * qty
      : (exitPrice - entryPrice) * qty;

  return Number(delta.toFixed(8));
}

function resolveExitTimestamp(tradeStats, order) {
  const orderUpdate = Number(order?.updateTime);
  const candidates = [
    tradeStats.lastTradeTime,
    Number.isFinite(orderUpdate) ? orderUpdate : null,
    Date.now(),
  ].filter((value) => Number.isFinite(value) && value > 0);

  const timestamp = candidates.length ? Math.max(...candidates) : Date.now();
  return new Date(timestamp);
}

function summarizeSettlement({ position, trades, order }) {
  const stats = aggregateTradeStats(trades);
  const entryFees = toNumber(position.fees) ?? 0;
  const exitFees = Number(stats.fees.toFixed(8));
  const totalFees = Number((entryFees + exitFees).toFixed(8));

  const tradeBasedPnl = stats.realizedPnl;
  const hasMeaningfulTradePnl =
    trades.length > 0 &&
    Number.isFinite(tradeBasedPnl) &&
    Math.abs(tradeBasedPnl) > Number.EPSILON;

  const avgTradePrice =
    stats.totalQty > 0 ? stats.totalNotional / stats.totalQty : null;
  const resolvedExitPrice =
    toNumber(order?.avgPrice) ?? avgTradePrice ?? toNumber(order?.price);
  const fallbackPnl = computeDirectionalPnl({
    side: position.side,
    entryPrice: toNumber(position.price),
    exitPrice: resolvedExitPrice,
    qty: toNumber(order?.executedQty ?? position.qty),
  });

  const realizedPnl = hasMeaningfulTradePnl
    ? tradeBasedPnl
    : (fallbackPnl ?? tradeBasedPnl ?? 0);

  const netPnl = Number((realizedPnl - totalFees).toFixed(8));
  const exitTime = resolveExitTimestamp(stats, order);

  return {
    exitTime,
    exitPrice: resolvedExitPrice,
    netPnl,
    totalFees,
    exitFees,
    realizedPnl,
  };
}

function orderFilled(order) {
  return order?.status === 'FILLED';
}

async function detectFilledExitOrder(position, log) {
  const candidates = [];
  if (position.tpOrderId) {
    candidates.push({ type: 'tp', orderId: position.tpOrderId });
  }
  if (position.slOrderId) {
    candidates.push({ type: 'sl', orderId: position.slOrderId });
  }

  const filledOrders = [];

  for (const candidate of candidates) {
    const order = await fetchOrderStatus(position, candidate.orderId, log);
    if (orderFilled(order)) {
      filledOrders.push({ ...candidate, order });
    }
  }

  if (!filledOrders.length) {
    return null;
  }

  if (filledOrders.length === 1) {
    return filledOrders[0];
  }

  return filledOrders.sort((a, b) => {
    const aTime = Number(a.order?.updateTime ?? 0);
    const bTime = Number(b.order?.updateTime ?? 0);
    return bTime - aTime;
  })[0];
}

async function cancelSiblingOrder({ position, closedType, log }) {
  const siblingId =
    closedType === 'tp' ? position.slOrderId : position.tpOrderId;
  if (!siblingId) {
    return false;
  }

  const params = buildOrderLookupParams(position.symbol, siblingId);
  if (!params) {
    return false;
  }

  try {
    await cancelOrder(params);
    log.info(
      {
        positionId: position.id,
        symbol: position.symbol,
        canceledOrderId: siblingId,
      },
      '[PositionSettlement] Ordem oposta cancelada apos fechamento'
    );
    return true;
  } catch (error) {
    // -2011 = Unknown order, -2013 = No such order
    if ([-2011, -2013].includes(Number(error?.code))) {
      log.debug(
        {
          positionId: position.id,
          symbol: position.symbol,
          canceledOrderId: siblingId,
        },
        '[PositionSettlement] Ordem oposta ja estava encerrada'
      );
      return true;
    }

    log.error(
      {
        positionId: position.id,
        symbol: position.symbol,
        canceledOrderId: siblingId,
        err: error,
      },
      '[PositionSettlement] Falha ao cancelar ordem oposta'
    );
    return false;
  }
}

function buildUpdatePayload({ exitTime, exitPrice, totalFees, netPnl }) {
  return {
    status: STATUS_CLOSED,
    exitTime,
    exitPrice,
    pnl: netPnl,
    fees: totalFees,
  };
}

async function resetAssetAfterPositionClosed(position, log) {
  try {
    await Promise.all([
      updateAssetState(position.symbol, {
        status: STATUS_AWAITING_CROSS,
        side: null,
        candleCrossTime: null,
        orderId: null,
      }),
      updateAssetTriggerPrice(position.symbol, null),
    ]);

    log.info(
      { symbol: position.symbol },
      '[PositionSettlement] Asset resetado apos fechamento da position'
    );
  } catch (error) {
    log.error(
      { symbol: position.symbol, err: error },
      '[PositionSettlement] Falha ao resetar asset apos fechamento'
    );
  }
}

export async function settleClosedPositions(options = {}) {
  const baseLogger = options.logger ?? loggerFactory;
  const log =
    typeof baseLogger?.child === 'function'
      ? baseLogger.child({ contexto: 'position-exit-settlement' })
      : baseLogger;

  const openPositions = await listPositions({ status: STATUS_OPEN });
  const monitoredPositions = openPositions.filter(
    (position) => position.tpOrderId || position.slOrderId
  );

  if (!monitoredPositions.length) {
    log.trace('[PositionSettlement] Nenhuma position aguardando TP/SL fill');
    return { processed: 0, closed: 0 };
  }

  let closed = 0;

  for (const position of monitoredPositions) {
    try {
      const closingInfo = await detectFilledExitOrder(position, log);
      if (!closingInfo) {
        continue;
      }

      const trades = await fetchTradesForOrder(
        position.symbol,
        closingInfo.order
      );
      const settlement = summarizeSettlement({
        position,
        trades,
        order: closingInfo.order,
      });

      const payload = buildUpdatePayload({
        exitTime: settlement.exitTime,
        exitPrice: settlement.exitPrice,
        totalFees: settlement.totalFees,
        netPnl: settlement.netPnl,
      });

      await updatePosition(position.id, payload);
      await cancelSiblingOrder({ position, closedType: closingInfo.type, log });
      await resetAssetAfterPositionClosed(position, log);

      closed += 1;
      log.info(
        {
          positionId: position.id,
          symbol: position.symbol,
          orderId:
            closingInfo.order?.orderId ?? closingInfo.order?.clientOrderId,
          exitTime: settlement.exitTime,
          pnl: settlement.netPnl,
          totalFees: settlement.totalFees,
          type: closingInfo.type,
        },
        '[PositionSettlement] Position encerrada com sucesso'
      );
    } catch (error) {
      log.error(
        { positionId: position.id, symbol: position.symbol, err: error },
        '[PositionSettlement] Falha ao processar position'
      );
    }
  }

  return {
    processed: monitoredPositions.length,
    closed,
  };
}

export default {
  settleClosedPositions,
};
