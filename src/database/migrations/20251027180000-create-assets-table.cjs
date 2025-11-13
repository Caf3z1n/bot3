module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('assets', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      symbol: {
        allowNull: false,
        type: Sequelize.STRING(16),
        unique: true,
      },
      status: {
        allowNull: false,
        type: Sequelize.ENUM(
          'awaiting_cross',
          'awaiting_pullback',
          'in_position',
          'cooldown'
        ),
        defaultValue: 'awaiting_cross',
      },
      side: {
        allowNull: true,
        type: Sequelize.ENUM('long', 'short'),
      },
      ema_fast_2: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      ema_fast_1: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      ema_slow_2: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      ema_slow_1: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      unix_current_candle: {
        allowNull: true,
        type: Sequelize.BIGINT,
      },
      candle_cross_time: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      step_size: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 10),
      },
      tick_size: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 10),
      },
      min_qty: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 10),
      },
      trigger_price: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      order_id: {
        allowNull: true,
        type: Sequelize.STRING(64),
      },
      max_notional: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      leverage: {
        allowNull: true,
        type: Sequelize.INTEGER,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('assets');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_assets_status";'
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_assets_side";'
    );
  },
};
