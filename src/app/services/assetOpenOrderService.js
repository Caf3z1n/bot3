import loggerFactory from '../../utils/logger.js';
import Asset from '../../database/models/Asset.js';
import {
  listAssets,
  updateAssetOrderId,
} from '../../database/repositories/assetRepository.js';
import {
  fetchAccountBalance,
  fetchPositionMode,
  placeOrder,
  setLeverage,
} from '../../utils/binanceClient.js';
import strategy from '../../config/strategy.js';

const STATUS_AWAITING_PULLBACK = Asset.Status.AWAITING_PULLBACK;
const SIDE_SHORT = Asset.Side.SHORT;

const RISK_FRACTION = Number(strategy?.risk?.perTradePct ?? 0) / 100;
const BASE_LEVERAGE = Number(strategy?.risk?.leverage ?? 0);
const NOTIONAL_CAP_MARGIN = 0.99; // keep orders 1% below exchange limit
const MARGIN_ASSET = String(
  strategy?.risk?.marginAsset ?? 'USDT'
).toUpperCase();

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function snapQuantity(value, stepSize) {
  const step = stepSize > 0 ? stepSize : 1;
  const snapped = Math.floor(value / step + Number.EPSILON) * step;
  return Number(snapped.toFixed(8));
}

function snapPrice(value, tickSize, side, hedgeMode) {
  const step = tickSize > 0 ? tickSize : 1;
  if (hedgeMode) {
    const raw =
      side === SIDE_SHORT
        ? Math.floor(value / step + Number.EPSILON) * step
        : Math.ceil(value / step - Number.EPSILON) * step;
    return Number(raw.toFixed(8));
  }

  const raw = Math.floor(value / step + Number.EPSILON) * step;
  return Number(raw.toFixed(8));
}

function formatDecimal(value) {
  return Number.isFinite(value) ? value.toFixed(8) : null;
}

async function resolveAvailableBalance(logger) {
  const balances = await fetchAccountBalance();
  const entry =
    balances.find((item) => item.asset === MARGIN_ASSET) ?? balances[0];

  if (!entry) {
    logger.warn('[OpenOrder] Nao foi possivel obter saldo da conta');
    return 0;
  }

  const available = toNumber(entry.availableBalance ?? entry.balance ?? 0);
  return available ?? 0;
}

function computeQuantity({
  availableBalance,
  price,
  stepSize,
  minQty,
  leverage,
}) {
  const riskFraction = RISK_FRACTION * (BASE_LEVERAGE / leverage);

  const riskNotional = availableBalance * riskFraction;
  const leveragedNotional = riskNotional * leverage;
  const rawQty = leveragedNotional / price;
  const steppedQty = snapQuantity(rawQty, stepSize);
  const minQuantity = toNumber(minQty) ?? 0;

  if (minQuantity > 0 && steppedQty < minQuantity) {
    return snapQuantity(minQuantity, stepSize);
  }

  return steppedQty;
}

function buildOrderPayload({ asset, price, quantity, hedgeMode }) {
  const isShort = asset.side === SIDE_SHORT;
  const side = isShort ? 'SELL' : 'BUY';
  const payload = {
    symbol: asset.symbol,
    side,
    type: 'LIMIT',
    timeInForce: 'GTC',
    quantity: formatDecimal(quantity),
    price: formatDecimal(price),
  };

  if (hedgeMode) {
    payload.positionSide = isShort ? 'SHORT' : 'LONG';
  }

  return payload;
}

export async function openOrdersForTriggerAssets(options = {}) {
  const baseLogger = options.logger ?? loggerFactory;
  const log =
    typeof baseLogger.child === 'function'
      ? baseLogger.child({ contexto: 'asset-open-order' })
      : baseLogger;

  if (RISK_FRACTION <= 0) {
    log.warn('[OpenOrder] Risco configurado como zero; abortando');
    return [];
  }

  const assets = (await listAssets()).filter((asset) => {
    const hasTrigger = toNumber(asset.triggerPrice) != null;
    return (
      asset.status === STATUS_AWAITING_PULLBACK && hasTrigger && !asset.orderId
    );
  });

  if (!assets.length) {
    log.debug('[OpenOrder] Nenhum ativo elegivel para abrir ordem');
    return [];
  }

  log.debug(
    { total: assets.length },
    '[OpenOrder] Ativos elegiveis carregados'
  );

  let availableBalance = await resolveAvailableBalance(log);
  if (availableBalance <= 0) {
    log.warn('[OpenOrder] Saldo indisponivel; abortando criacao de ordens');
    return [];
  }

  const positionMode = await fetchPositionMode().catch((error) => {
    log.warn(
      { err: error },
      '[OpenOrder] Falha ao obter position mode; assumindo one-way'
    );
    return null;
  });

  const hedgeMode = Boolean(positionMode?.dualSidePosition);
  const createdOrders = [];

  for (const asset of assets) {
    const triggerPrice = toNumber(asset.triggerPrice);
    const stepSize = toNumber(asset.stepSize);
    const tickSize = toNumber(asset.tickSize);
    const minQty = toNumber(asset.minQty);
    const maxNotional = toNumber(asset.maxNotional);
    const emaFast1 = toNumber(asset.emaFast1);
    const LEVERAGE = toNumber(asset.leverage);

    const dadosInsuficientes =
      !Number.isFinite(triggerPrice) ||
      !Number.isFinite(stepSize) ||
      !Number.isFinite(tickSize) ||
      !Number.isFinite(emaFast1) ||
      !Number.isFinite(minQty) ||
      !Number.isFinite(maxNotional);

    if (dadosInsuficientes) {
      log.warn(
        {
          symbol: asset.symbol,
          asset,
        },
        '[OpenOrder] Filtros insuficientes para montar ordem; pulando'
      );
      // eslint-disable-next-line no-continue
      continue;
    }

    if (availableBalance <= 0) {
      log.warn('[OpenOrder] Saldo residual zerado; interrompendo ciclo');
      break;
    }

    try {
      const orderPrice = snapPrice(
        triggerPrice,
        tickSize,
        asset.side,
        hedgeMode
      );

      let quantity = computeQuantity({
        availableBalance,
        price: orderPrice,
        stepSize,
        minQty,
        leverage: LEVERAGE,
      });

      if (!Number.isFinite(quantity) || quantity <= 0) {
        log.warn(
          { symbol: asset.symbol },
          '[OpenOrder] Quantidade calculada invalida; pulando'
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      if (Number.isFinite(maxNotional) && maxNotional > 0) {
        const notional = orderPrice * quantity;
        const effectiveMaxNotional = maxNotional * NOTIONAL_CAP_MARGIN;
        if (effectiveMaxNotional <= 0) {
          log.warn(
            { symbol: asset.symbol, maxNotional },
            '[OpenOrder] Max notional configurado zerado; pulando ativo'
          );
          // eslint-disable-next-line no-continue
          continue;
        }

        if (notional > effectiveMaxNotional) {
          const cappedQty = snapQuantity(
            effectiveMaxNotional / orderPrice,
            stepSize
          );
          if (!Number.isFinite(cappedQty) || cappedQty <= 0) {
            log.warn(
              {
                symbol: asset.symbol,
                maxNotional,
                effectiveMaxNotional,
                orderPrice,
              },
              '[OpenOrder] Notional cap muito baixo; pulando ativo'
            );
            // eslint-disable-next-line no-continue
            continue;
          }

          if (cappedQty < quantity) {
            log.warn(
              {
                symbol: asset.symbol,
                previousNotional: notional,
                cappedNotional: orderPrice * cappedQty,
                maxNotional,
                effectiveMaxNotional,
              },
              '[OpenOrder] Notional cap atingido; ajustando quantidade'
            );
            quantity = cappedQty;
          }
        }
      }

      if (Number.isFinite(minQty) && minQty > 0 && quantity < minQty) {
        log.error(
          { symbol: asset.symbol, quantity, minQty },
          '[OpenOrder] Quantidade ajustada menor que minQty; pulando'
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      const requiredMargin = (orderPrice * quantity) / LEVERAGE;
      if (!Number.isFinite(requiredMargin) || requiredMargin <= 0) {
        log.warn(
          { symbol: asset.symbol },
          '[OpenOrder] Margem calculada invalida; pulando'
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      if (requiredMargin > availableBalance) {
        log.error(
          {
            symbol: asset.symbol,
            requiredMargin,
            availableBalance,
          },
          '[OpenOrder] Margem insuficiente para nova ordem; encerrando ciclo'
        );
        break;
      }

      await setLeverage({ symbol: asset.symbol, leverage: asset.leverage });

      const payload = buildOrderPayload({
        asset,
        price: orderPrice,
        quantity,
        hedgeMode,
      });

      const response = await placeOrder(payload);
      const orderId = response?.orderId ?? response?.clientOrderId ?? null;

      if (!orderId) {
        log.warn(
          { symbol: asset.symbol, response },
          '[OpenOrder] Ordem criada sem orderId; resposta inesperada'
        );
        // eslint-disable-next-line no-continue
        continue;
      }

      await updateAssetOrderId(asset.symbol, String(orderId));
      createdOrders.push({ symbol: asset.symbol, orderId: String(orderId) });

      availableBalance = Math.max(0, availableBalance - requiredMargin);

      log.info(
        {
          symbol: asset.symbol,
          orderId,
          price: orderPrice,
          quantity,
          hedgeMode,
          remainingBalance: availableBalance,
        },
        '[OpenOrder] Ordem limit criada com sucesso'
      );
    } catch (error) {
      log.error(
        { symbol: asset.symbol, err: error },
        '[OpenOrder] Falha ao criar ordem limit'
      );
    }
  }

  return createdOrders;
}

export default {
  openOrdersForTriggerAssets,
};
