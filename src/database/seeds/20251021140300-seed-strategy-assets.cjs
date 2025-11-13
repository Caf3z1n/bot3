module.exports = {
  async up(queryInterface) {
    const { default: strategy } = await import('../../config/strategy.js');
    const symbols = strategy.symbols ?? [];

    if (symbols.length === 0) {
      throw new Error(
        '[seed:strategy-assets] Nenhum simbolo configurado em BOT3_SYMBOLS'
      );
    }

    const now = new Date();
    const rows = symbols.map((symbol) => ({
      symbol,
      status: 'awaiting_cross',
      ema_fast_period: strategy.emaFastPeriod ?? null,
      ema_slow_period: strategy.emaSlowPeriod ?? null,
      pullback_penetration_pct: strategy.pullback?.penetrationPct ?? null,
      take_profit_pct: strategy.takeProfitPct ?? null,
      stop_loss_pct: strategy.stopLossPct ?? null,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert('assets', rows, {});
  },

  async down(queryInterface) {
    const { default: strategy } = await import('../../config/strategy.js');
    const symbols = strategy.symbols ?? [];

    if (!symbols.length) {
      return;
    }

    await queryInterface.bulkDelete(
      'assets',
      {
        symbol: symbols,
      },
      {}
    );
  },
};
