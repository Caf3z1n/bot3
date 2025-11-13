import { Op } from 'sequelize';
import loggerFactory from '../../utils/logger.js';
import Asset from '../../database/models/Asset.js';
import Position from '../../database/models/Position.js';
import { initDatabase } from '../../database/index.js';
import { listAssets } from '../../database/repositories/assetRepository.js';
import {
  cancelAllOpenOrders,
  fetchPositions,
  fetchPositionMode,
  placeOrder,
} from '../../utils/binanceClient.js';

const STATUS_AWAITING_CROSS = Asset.Status.AWAITING_CROSS;
const POSITION_STATUS_CLOSED = Position.Status.CLOSED;

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeQuantity(value) {
  const numeric = Math.abs(toNumber(value) ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Number(numeric.toFixed(8));
}

export async function resetBotState(options = {}) {
  const baseLogger = options.logger ?? loggerFactory;
  const log =
    typeof baseLogger?.child === 'function'
      ? baseLogger.child({ contexto: 'bot-reset' })
      : baseLogger;

  await initDatabase();

  const assets = await listAssets();
  const cancellation = {
    attempted: assets.length,
    succeeded: 0,
    failures: [],
  };

  for (const asset of assets) {
    try {
      await cancelAllOpenOrders({ symbol: asset.symbol });
      cancellation.succeeded += 1;
      log.info(
        { symbol: asset.symbol },
        '[BotReset] Ordens abertas canceladas'
      );
    } catch (error) {
      cancellation.failures.push(asset.symbol);
      log.warn(
        { symbol: asset.symbol, err: error },
        '[BotReset] Falha ao cancelar ordens abertas'
      );
    }
  }

  let hedgeMode = false;
  try {
    const positionMode = await fetchPositionMode();
    hedgeMode = Boolean(positionMode?.dualSidePosition);
  } catch (error) {
    log.warn(
      { err: error },
      '[BotReset] Falha ao obter position mode; assumindo one-way'
    );
  }

  const closures = {
    attempted: 0,
    succeeded: 0,
    failures: [],
  };

  try {
    const exchangePositions = await fetchPositions();

    for (const position of exchangePositions) {
      const amount = toNumber(position?.positionAmt);
      if (!Number.isFinite(amount) || Math.abs(amount) <= Number.EPSILON) {
        continue;
      }

      const quantity = normalizeQuantity(amount);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        continue;
      }

      const payload = {
        symbol: position.symbol,
        type: 'MARKET',
        reduceOnly: true,
        quantity,
      };

      let side;

      if (hedgeMode) {
        const positionSide = String(position?.positionSide ?? '').toUpperCase();
        if (positionSide === 'LONG') {
          side = 'SELL';
          payload.positionSide = 'LONG';
        } else if (positionSide === 'SHORT') {
          side = 'BUY';
          payload.positionSide = 'SHORT';
        } else {
          side = amount > 0 ? 'SELL' : 'BUY';
        }
      } else {
        side = amount > 0 ? 'SELL' : 'BUY';
      }

      payload.side = side;
      closures.attempted += 1;

      try {
        await placeOrder(payload);
        closures.succeeded += 1;
        log.info(
          {
            symbol: payload.symbol,
            side: payload.side,
            quantity: payload.quantity,
            positionSide: payload.positionSide ?? 'BOTH',
          },
          '[BotReset] Ordem de fechamento enviada'
        );
      } catch (error) {
        closures.failures.push({
          symbol: payload.symbol,
          positionSide: payload.positionSide ?? 'BOTH',
          error: error?.message ?? String(error),
        });
        log.error(
          {
            symbol: payload.symbol,
            positionSide: payload.positionSide ?? 'BOTH',
            err: error,
          },
          '[BotReset] Falha ao enviar ordem de fechamento'
        );
      }
    }
  } catch (error) {
    log.error(
      { err: error },
      '[BotReset] Falha ao recuperar posicoes abertas; fechamento abortado'
    );
  }

  const [positionsClosed] = await Position.update(
    {
      status: POSITION_STATUS_CLOSED,
      exitTime: new Date(),
      tpOrderId: null,
      slOrderId: null,
    },
    {
      where: {
        status: {
          [Op.ne]: POSITION_STATUS_CLOSED,
        },
      },
    }
  );

  const [assetUpdates] = await Asset.update(
    {
      status: STATUS_AWAITING_CROSS,
      side: null,
      triggerPrice: null,
      candleCrossTime: null,
      orderId: null,
    },
    {
      where: {},
    }
  );

  log.info(
    {
      assetsProcessed: assets.length,
      assetsReset: assetUpdates,
      positionsClosed,
      hedgeMode,
      cancellations: cancellation,
      exchangeClosures: closures,
    },
    '[BotReset] Rotina de reset concluida'
  );

  return {
    assetsProcessed: assets.length,
    assetsReset: assetUpdates,
    positionsClosed,
    hedgeMode,
    cancellations: cancellation,
    exchangeClosures: closures,
  };
}

export default {
  resetBotState,
};
