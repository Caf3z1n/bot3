module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('positions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      symbol: {
        allowNull: false,
        type: Sequelize.STRING(16),
      },
      side: {
        allowNull: false,
        type: Sequelize.ENUM('long', 'short'),
      },
      status: {
        allowNull: false,
        type: Sequelize.ENUM('open', 'closed'),
        defaultValue: 'open',
      },
      order_id: {
        allowNull: true,
        type: Sequelize.STRING(64),
      },
      tp_order_id: {
        allowNull: true,
        type: Sequelize.STRING(64),
      },
      sl_order_id: {
        allowNull: true,
        type: Sequelize.STRING(64),
      },
      candle_cross_time: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      fees: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      price: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      tp_price: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      sl_price: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      notional: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      qty: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      exit_time: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      exit_price: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
      },
      pnl: {
        allowNull: true,
        type: Sequelize.DECIMAL(20, 8),
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
    await queryInterface.dropTable('positions');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_positions_side";'
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_positions_status";'
    );
  },
};
