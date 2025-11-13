import loggerFactory from '../../utils/logger.js';
import {
  fetchExchangeInfo,
  fetchLeverageBrackets,
} from '../../utils/binanceClient.js';
import {
  listAssets,
  updateAssetTradingFilters,
} from '../../database/repositories/assetRepository.js';
import strategy from '../../config/strategy.js';

const LEVERAGE = Math.max(1, Math.trunc(Number(strategy?.risk?.leverage ?? 1)));

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractExchangeFilters(symbolInfo) {
  if (!symbolInfo || !Array.isArray(symbolInfo.filters)) {
    return { stepSize: null, tickSize: null, minQty: null };
  }

  const lotSizeFilter = symbolInfo.filters.find(
    (filter) => filter.filterType === 'LOT_SIZE'
  );
  const priceFilter = symbolInfo.filters.find(
    (filter) => filter.filterType === 'PRICE_FILTER'
  );

  return {
    stepSize: toNumber(lotSizeFilter?.stepSize ?? null),
    tickSize: toNumber(priceFilter?.tickSize ?? null),
    minQty: toNumber(lotSizeFilter?.minQty ?? null),
  };
}

function resolveMaxNotionalAndLeverage(brackets, leverage = 100) {
  const list = (Array.isArray(brackets) ? brackets : [])
    .map((b) => ({
      il: +b.initialLeverage,
      cap: +b.notionalCap,
      br: +b.bracket,
    }))
    .filter((b) => Number.isFinite(b.il))
    .sort((a, b) => a.br - b.br);

  if (!list.length) return { maxNotional: null, leverageUsed: leverage };

  const maxIL = list.reduce((m, b) => Math.max(m, b.il), 0);
  const leverageUsed = Math.min(leverage, maxIL);

  const tier = list.find((b) => leverageUsed <= b.il) || list[list.length - 1];
  // eslint-disable-next-line no-nested-ternary
  const maxNotional = tier ? (tier.cap === 0 ? Infinity : tier.cap) : null;

  return { maxNotional, leverageUsed };
}

/**
 * Atualiza filtros de tamanho e notional para todos os ativos cadastrados.
 * @param {{ logger?: import('pino').Logger }} [options]
 */
export async function syncAssetMetadata(options = {}) {
  const baseLogger = options.logger ?? loggerFactory;
  const log =
    typeof baseLogger.child === 'function'
      ? baseLogger.child({ contexto: 'asset-metadata' })
      : baseLogger;

  log.info('[AssetMetadata] Iniciando sincronizacao de metadados...');

  const [assets, exchangeInfo, leverageBrackets] = await Promise.all([
    listAssets(),
    fetchExchangeInfo(),
    fetchLeverageBrackets(),
  ]);

  const exchangeMap = new Map(
    (exchangeInfo?.symbols ?? []).map((entry) => [entry.symbol, entry])
  );
  const bracketMap = new Map(
    (leverageBrackets ?? []).map((entry) => [entry.symbol, entry.brackets])
  );

  let updated = 0;

  for (const asset of assets) {
    const info = exchangeMap.get(asset.symbol);
    const brackets = bracketMap.get(asset.symbol);

    const payload = {};
    let hasChanges = false;

    if (!info) {
      log.warn(
        { symbol: asset.symbol },
        '[AssetMetadata] Exchange info nao encontrada; filtros serao ignorados'
      );
    } else {
      const filters = extractExchangeFilters(info);
      const hasFilterValues =
        filters.stepSize != null ||
        filters.tickSize != null ||
        filters.minQty != null;

      if (!hasFilterValues) {
        log.warn(
          { symbol: asset.symbol },
          '[AssetMetadata] Filtros ausentes para o simbolo; ignorando'
        );
      } else {
        payload.stepSize = filters.stepSize ?? null;
        payload.tickSize = filters.tickSize ?? null;
        payload.minQty = filters.minQty ?? null;
        hasChanges = true;
      }
    }

    const { maxNotional, leverageUsed } = resolveMaxNotionalAndLeverage(
      brackets,
      LEVERAGE
    );
    if (maxNotional != null && leverageUsed != null) {
      payload.maxNotional = maxNotional;
      payload.leverage = leverageUsed;
      hasChanges = true;
    } else {
      log.warn(
        { symbol: asset.symbol },
        '[AssetMetadata] Max notional nao encontrado para leverage configurado'
      );
    }

    if (!hasChanges) {
      log.debug(
        { symbol: asset.symbol },
        '[AssetMetadata] Nenhum metadado atualizado para este ativo'
      );
    } else {
      await updateAssetTradingFilters(asset.symbol, payload);
      updated += 1;

      log.debug(
        { symbol: asset.symbol, ...payload },
        '[AssetMetadata] Metadados atualizados com sucesso'
      );
    }
  }

  log.info(
    { ativosAtualizados: updated },
    '[AssetMetadata] Sincronizacao de metadados concluida'
  );
}

export default {
  syncAssetMetadata,
};
