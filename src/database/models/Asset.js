import { Model, DataTypes } from 'sequelize';

function formatDateTimeBr(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(date);
}

function toNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export default class Asset extends Model {
  static Status = {
    AWAITING_CROSS: 'awaiting_cross',
    AWAITING_PULLBACK: 'awaiting_pullback',
    IN_POSITION: 'in_position',
    COOLDOWN: 'cooldown',
  };

  static Side = {
    LONG: 'long',
    SHORT: 'short',
  };

  static SideBias = Asset.Side;

  static initialize(sequelize) {
    super.init(
      {
        symbol: {
          type: DataTypes.STRING(16),
          allowNull: false,
          unique: true,
          validate: {
            notEmpty: true,
          },
        },
        status: {
          type: DataTypes.ENUM(...Object.values(Asset.Status)),
          allowNull: false,
          defaultValue: Asset.Status.AWAITING_CROSS,
        },
        side: {
          type: DataTypes.ENUM(...Object.values(Asset.Side)),
          allowNull: true,
        },
        emaFast2: {
          field: 'ema_fast_2',
          type: DataTypes.DECIMAL(20, 8),
        },
        emaFast1: {
          field: 'ema_fast_1',
          type: DataTypes.DECIMAL(20, 8),
        },
        emaSlow2: {
          field: 'ema_slow_2',
          type: DataTypes.DECIMAL(20, 8),
        },
        emaSlow1: {
          field: 'ema_slow_1',
          type: DataTypes.DECIMAL(20, 8),
        },
        emaFastPeriod: {
          field: 'ema_fast_period',
          type: DataTypes.INTEGER,
        },
        emaSlowPeriod: {
          field: 'ema_slow_period',
          type: DataTypes.INTEGER,
        },
        pullbackPenetrationPct: {
          field: 'pullback_penetration_pct',
          type: DataTypes.DECIMAL(10, 8),
        },
        takeProfitPct: {
          field: 'take_profit_pct',
          type: DataTypes.DECIMAL(10, 8),
        },
        stopLossPct: {
          field: 'stop_loss_pct',
          type: DataTypes.DECIMAL(10, 8),
        },
        unixCurrentCandle: {
          field: 'unix_current_candle',
          type: DataTypes.BIGINT,
        },
        candleCrossTime: {
          field: 'candle_cross_time',
          type: DataTypes.DATE,
        },
        stepSize: {
          field: 'step_size',
          type: DataTypes.DECIMAL(20, 10),
        },
        tickSize: {
          field: 'tick_size',
          type: DataTypes.DECIMAL(20, 10),
        },
        minQty: {
          field: 'min_qty',
          type: DataTypes.DECIMAL(20, 10),
        },
        triggerPrice: {
          field: 'trigger_price',
          type: DataTypes.DECIMAL(20, 8),
        },
        orderId: {
          field: 'order_id',
          type: DataTypes.STRING(64),
        },
        maxNotional: {
          field: 'max_notional',
          type: DataTypes.DECIMAL(20, 8),
        },
        leverage: {
          field: 'leverage',
          type: DataTypes.INTEGER,
        },
        candleCrossTimeBr: {
          type: DataTypes.VIRTUAL,
          get() {
            return formatDateTimeBr(this.getDataValue('candleCrossTime'));
          },
        },
        createdAtBr: {
          type: DataTypes.VIRTUAL,
          get() {
            return formatDateTimeBr(this.getDataValue('createdAt'));
          },
        },
        updatedAtBr: {
          type: DataTypes.VIRTUAL,
          get() {
            return formatDateTimeBr(this.getDataValue('updatedAt'));
          },
        },
        emaTrendStatus: {
          type: DataTypes.VIRTUAL,
          get() {
            const fast1 = toNumber(this.getDataValue('emaFast1'));
            const fast2 = toNumber(this.getDataValue('emaFast2'));
            const slow1 = toNumber(this.getDataValue('emaSlow1'));
            const slow2 = toNumber(this.getDataValue('emaSlow2'));

            if ([fast1, fast2, slow1, slow2].includes(null)) {
              return null;
            }

            const fastAboveSlow = fast1 > slow1 && fast2 > slow2;
            const fastBelowSlow = fast1 < slow1 && fast2 < slow2;
            const fastIncreasing = fast1 > fast2;
            const fastDecreasing = fast1 < fast2;
            const slowIncreasing = slow1 > slow2;
            const slowDecreasing = slow1 < slow2;

            if (fastAboveSlow && fastIncreasing && slowIncreasing) {
              return 'Continuação da Alta';
            }

            if (fastBelowSlow && fastDecreasing && slowDecreasing) {
              return 'Continuação da Baixa';
            }

            if (fastAboveSlow && fastDecreasing) {
              return 'Cruzando Short';
            }

            if (fastBelowSlow && fastIncreasing) {
              return 'Cruzando Long';
            }

            return null;
          },
        },
        emaDiffPercent: {
          type: DataTypes.VIRTUAL,
          get() {
            const fast = toNumber(this.getDataValue('emaFast1'));
            const slow = toNumber(this.getDataValue('emaSlow1'));

            if (fast === null || slow === null) {
              return null;
            }

            const denominator = Math.abs(slow);
            if (denominator === 0) {
              return null;
            }

            return ((fast - slow) / denominator) * 100;
          },
        },
      },
      {
        sequelize,
        tableName: 'assets',
        modelName: 'Asset',
        underscored: true,
        timestamps: true,
        defaultScope: {
          order: [['id', 'ASC']],
        },
      }
    );

    return Asset;
  }
}
