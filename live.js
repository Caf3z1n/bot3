import 'dotenv/config';
import { setTimeout as delay } from 'timers/promises';
import logger from './src/utils/logger.js';
import { syncAssetIndicators } from './src/app/services/assetIndicatorSyncService.js';
import { processAssetSignals } from './src/app/services/assetService.js';
import { syncAssetMetadata } from './src/app/services/assetMetadataService.js';
import { openOrdersForTriggerAssets } from './src/app/services/assetOpenOrderService.js';
import { recoverPullbackAssets } from './src/app/services/pullbackRecoveryService.js';
import { checkBinanceOrders } from './src/app/services/checkBinanceOrderService.js';
import { ensureTpSlOrdersForPositions } from './src/app/services/positionExitOrderService.js';
import { settleClosedPositions } from './src/app/services/positionExitSettlementService.js';

const INTERVAL_MS = 10_000;
const HOUR_MS = 3_600_000;

async function runHourlyCycle() {
  logger.info('[Live] Executando nova rotina horaria');
  await syncAssetMetadata({ logger }); // Atualiza metadados dos ativos (step_size, tick_size, leverage etc.)
}

async function executeTask() {
  try {
    logger.debug('[Live] Iniciando novo ciclo de atualizacao');

    const updatedSymbols = await syncAssetIndicators({ logger }); // Recalcula indicadores tecnicos e retorna simbolos com alteracao
    if (updatedSymbols.length > 0) {
      logger.info(
        `[Live] ${updatedSymbols.length} Candles atualizados; processando sinais...`
      );
      await processAssetSignals({ logger }); // Aplica regras de cruzamento/trigger price para gerar sinais utilizaveis

      await openOrdersForTriggerAssets({ logger }); // Abre ordens para os ativos com trigger price mas sem orderId
    } else {
      logger.debug('[Live] Nenhuma atualizacao; pulando cruzamentos e filtros');
    }

    await recoverPullbackAssets({ logger }); // Reconcilia ativos awaiting_pullback sem trigger/orderId

    await checkBinanceOrders({ logger }); // Verifica ordens pendentes e registra positions quando a Binance marcar FILLED
    await ensureTpSlOrdersForPositions({ logger }); // Garante TP/SL reduce-only closePosition para positions abertas sem protecao
    await settleClosedPositions({ logger }); // Consolida fills de TP/SL, atualiza pnl/fees e cancela ordem oposta
  } catch (error) {
    logger.error({ err: error }, '[Live] Falha ao executar ciclo');
  }
}

async function runFastCyclesUntil(deadline) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await executeTask();

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }

    await delay(Math.min(INTERVAL_MS, remaining));
  }
}

async function start() {
  logger.info('[Live] Loop principal iniciado');

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await runHourlyCycle();
    const nextHourly = Date.now() + HOUR_MS;
    await runFastCyclesUntil(nextHourly);
  }
}

function handleShutdown(signal) {
  logger.warn({ signal }, '[Live] Encerrando loop principal');
  process.exit(0);
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

start().catch((error) => {
  logger.fatal({ err: error }, '[Live] Erro inesperado ao iniciar');
  process.exit(1);
});
