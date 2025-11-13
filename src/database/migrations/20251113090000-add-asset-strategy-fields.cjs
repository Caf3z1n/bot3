async function loadStrategyDefaults() {
  try {
    const { default: strategy } = await import('../../config/strategy.js');
    return strategy ?? {};
  } catch (error) {
    throw new Error(
      `[migration:add-asset-strategy-fields] Failed to load strategy defaults: ${error.message}`
    );
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const strategy = await loadStrategyDefaults();

    await queryInterface.addColumn('assets', 'ema_fast_period', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.addColumn('assets', 'ema_slow_period', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.addColumn('assets', 'pullback_penetration_pct', {
      type: Sequelize.DECIMAL(10, 8),
      allowNull: true,
    });

    await queryInterface.addColumn('assets', 'take_profit_pct', {
      type: Sequelize.DECIMAL(10, 8),
      allowNull: true,
    });

    await queryInterface.addColumn('assets', 'stop_loss_pct', {
      type: Sequelize.DECIMAL(10, 8),
      allowNull: true,
    });

    const defaults = {
      ema_fast_period: Number.isFinite(strategy?.emaFastPeriod)
        ? strategy.emaFastPeriod
        : null,
      ema_slow_period: Number.isFinite(strategy?.emaSlowPeriod)
        ? strategy.emaSlowPeriod
        : null,
      pullback_penetration_pct: Number.isFinite(
        strategy?.pullback?.penetrationPct
      )
        ? strategy.pullback.penetrationPct
        : null,
      take_profit_pct: Number.isFinite(strategy?.takeProfitPct)
        ? strategy.takeProfitPct
        : null,
      stop_loss_pct: Number.isFinite(strategy?.stopLossPct)
        ? strategy.stopLossPct
        : null,
    };

    const hasDefaultValues = Object.values(defaults).some(
      (value) => value !== null && value !== undefined
    );

    if (hasDefaultValues) {
      await queryInterface.bulkUpdate('assets', defaults, {});
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('assets', 'stop_loss_pct');
    await queryInterface.removeColumn('assets', 'take_profit_pct');
    await queryInterface.removeColumn('assets', 'pullback_penetration_pct');
    await queryInterface.removeColumn('assets', 'ema_slow_period');
    await queryInterface.removeColumn('assets', 'ema_fast_period');
  },
};
