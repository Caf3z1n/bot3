/* eslint-disable no-continue */
import {
  listAssets,
  updateAssetBySymbol,
  findAssetBySymbol,
} from '../../database/repositories/assetRepository.js';
import { listPositions } from '../../database/repositories/positionsRepository.js';
import Position from '../../database/models/Position.js';
import { fetchMarkPrice } from '../../utils/binanceClient.js';

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const STATUS_IN_POSITION = 'in_position';
const STATUS_AWAITING_CROSS = 'awaiting_cross';
const POSITION_STATUS_OPEN = Position.Status.OPEN;
const SIDE_SHORT = Position.Side.SHORT;
const STRATEGY_FIELDS = new Set([
  'emaFastPeriod',
  'emaSlowPeriod',
  'pullbackPenetrationPct',
  'takeProfitPct',
  'stopLossPct',
]);

class AssetController {
  static async index(req, res) {
    const assets = await listAssets();
    const inPositionSymbols = assets
      .filter((asset) => asset?.status === STATUS_IN_POSITION)
      .map((asset) =>
        typeof asset?.symbol === 'string' ? asset.symbol.trim() : ''
      )
      .filter((symbol) => symbol.length > 0);

    const normalizedInPositionSymbols = new Set(
      inPositionSymbols.map((symbol) => symbol.toUpperCase())
    );

    const positionsBySymbol = new Map();

    if (normalizedInPositionSymbols.size > 0) {
      const openPositions = await listPositions({
        status: POSITION_STATUS_OPEN,
      });

      for (const position of openPositions) {
        const symbol =
          typeof position?.symbol === 'string'
            ? position.symbol.trim().toUpperCase()
            : '';

        if (
          !symbol ||
          !normalizedInPositionSymbols.has(symbol) ||
          positionsBySymbol.has(symbol)
        ) {
          continue;
        }

        positionsBySymbol.set(symbol, position);
      }
    }

    const assetsWithPrice = await Promise.all(
      assets.map(async (asset) => {
        const triggerPrice = toNumber(asset?.triggerPrice);
        const normalizedSymbol =
          typeof asset?.symbol === 'string'
            ? asset.symbol.trim().toUpperCase()
            : null;
        let positionNotional = null;
        let unrealizedPnl = null;
        let tpPrice = null;
        let slPrice = null;
        const position =
          normalizedSymbol != null
            ? positionsBySymbol.get(normalizedSymbol)
            : null;

        if (position) {
          const notionalValue = toNumber(position.notional);
          if (notionalValue != null) {
            positionNotional = notionalValue;
          }
        }

        try {
          if (!normalizedSymbol) {
            return {
              ...asset,
              currentPrice: null,
              triggerDiffPercent: null,
              positionNotional,
              unrealizedPnl,
            };
          }

          const pricePayload = await fetchMarkPrice(asset.symbol);
          const currentPrice = toNumber(pricePayload?.markPrice);
          const triggerDiffPercent =
            currentPrice != null && triggerPrice != null && triggerPrice !== 0
              ? Math.abs(((currentPrice - triggerPrice) / triggerPrice) * 100)
              : null;

          if (position && asset?.status === STATUS_IN_POSITION) {
            tpPrice = toNumber(position.tpPrice);
            slPrice = toNumber(position.slPrice);

            if (currentPrice != null) {
              const entryPrice = toNumber(position.price);
              const qty = toNumber(position.qty);

              if (
                entryPrice != null &&
                qty != null &&
                Number.isFinite(qty) &&
                Math.abs(qty) > 0
              ) {
                const diff = currentPrice - entryPrice;
                const multiplier = position.side === SIDE_SHORT ? -1 : 1;
                const rawPnl = diff * qty * multiplier;

                if (Number.isFinite(rawPnl)) {
                  unrealizedPnl = Number(rawPnl.toFixed(8));
                }
              }
            }
          }

          return {
            ...asset,
            currentPrice,
            triggerDiffPercent,
            positionNotional,
            unrealizedPnl,
            tpPrice,
            slPrice,
          };
        } catch (error) {
          return {
            ...asset,
            currentPrice: null,
            triggerDiffPercent: null,
            positionNotional,
            unrealizedPnl,
            tpPrice,
            slPrice,
          };
        }
      })
    );

    return res.json({ assets: assetsWithPrice });
  }

  static async update(req, res) {
    const rawSymbol =
      typeof req.query.symbol === 'string' ? req.query.symbol : '';
    const symbol = rawSymbol.trim().toUpperCase();

    if (!symbol) {
      return res
        .status(400)
        .json({ error: 'symbol query parameter is required' });
    }

    const changes = req.body ?? {};

    if (
      !changes ||
      typeof changes !== 'object' ||
      Object.keys(changes).length === 0
    ) {
      return res
        .status(400)
        .json({ error: 'request body must include fields to update' });
    }

    const existing = await findAssetBySymbol(symbol);
    if (!existing) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const includesStrategyFields = Object.keys(changes).some((key) =>
      STRATEGY_FIELDS.has(key)
    );

    if (
      includesStrategyFields &&
      existing.status !== STATUS_AWAITING_CROSS
    ) {
      return res.status(409).json({
        error:
          'Strategy fields can only be updated when the asset is awaiting_cross.',
      });
    }

    try {
      const updated = await updateAssetBySymbol(symbol, changes);

      const withPrice = await (async () => {
        try {
          const pricePayload = await fetchMarkPrice(updated.symbol);
          const currentPrice = toNumber(pricePayload?.markPrice);
          return { ...updated, currentPrice };
        } catch {
          return { ...updated, currentPrice: null };
        }
      })();

      return res.json({ asset: withPrice });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to update asset',
        details: error.message,
      });
    }
  }
}

export default AssetController;
