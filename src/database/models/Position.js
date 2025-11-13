/* eslint-disable no-nested-ternary */
import { Model, DataTypes, Sequelize } from 'sequelize';

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
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveResult(pnl) {
  if (!Number.isFinite(pnl)) {
    return null;
  }
  if (pnl > 0) {
    return 'profit';
  }
  if (pnl < 0) {
    return 'loss';
  }
  return null;
}

export default class Position extends Model {
  static Status = {
    OPEN: 'open',
    CLOSED: 'closed',
  };

  static Side = {
    LONG: 'long',
    SHORT: 'short',
  };

  static initialize(sequelize) {
    super.init(
      {
        symbol: {
          type: DataTypes.STRING(16),
          allowNull: false,
          validate: {
            notEmpty: true,
          },
        },
        side: {
          type: DataTypes.ENUM(...Object.values(Position.Side)),
          allowNull: false,
        },
        status: {
          type: DataTypes.ENUM(...Object.values(Position.Status)),
          allowNull: false,
          defaultValue: Position.Status.OPEN,
        },
        orderId: {
          field: 'order_id',
          type: DataTypes.STRING(64),
        },
        tpOrderId: {
          field: 'tp_order_id',
          type: DataTypes.STRING(64),
        },
        slOrderId: {
          field: 'sl_order_id',
          type: DataTypes.STRING(64),
        },
        candleCrossTime: {
          field: 'candle_cross_time',
          type: DataTypes.DATE,
        },
        fees: {
          type: DataTypes.DECIMAL(20, 8),
        },
        price: {
          type: DataTypes.DECIMAL(20, 8),
        },
        tpPrice: {
          field: 'tp_price',
          type: DataTypes.DECIMAL(20, 8),
        },
        slPrice: {
          field: 'sl_price',
          type: DataTypes.DECIMAL(20, 8),
        },
        exitPrice: {
          field: 'exit_price',
          type: DataTypes.DECIMAL(20, 8),
        },
        notional: {
          type: DataTypes.DECIMAL(20, 8),
        },
        qty: {
          type: DataTypes.DECIMAL(20, 8),
        },
        exitTime: {
          field: 'exit_time',
          type: DataTypes.DATE,
        },
        pnl: {
          type: DataTypes.DECIMAL(20, 8),
        },
        candleCrossTimeBr: {
          type: DataTypes.VIRTUAL,
          get() {
            return formatDateTimeBr(this.getDataValue('candleCrossTime'));
          },
        },
        exitTimeBr: {
          type: DataTypes.VIRTUAL,
          get() {
            return formatDateTimeBr(this.getDataValue('exitTime'));
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
        result: {
          type: DataTypes.VIRTUAL,
          get() {
            const pnl = toNumber(this.getDataValue('pnl'));
            return resolveResult(pnl);
          },
        },
        slippage: {
          type: DataTypes.VIRTUAL,
          get() {
            const pnl = toNumber(this.getDataValue('pnl'));
            const exitPrice = toNumber(this.getDataValue('exitPrice'));
            const tpPrice = toNumber(this.getDataValue('tpPrice'));
            const slPrice = toNumber(this.getDataValue('slPrice'));
            const qty = toNumber(this.getDataValue('qty'));

            const resultType = resolveResult(pnl);
            const expectedPrice =
              resultType === 'profit'
                ? tpPrice
                : resultType === 'loss'
                  ? slPrice
                  : null;

            if (
              !Number.isFinite(exitPrice) ||
              !Number.isFinite(expectedPrice) ||
              !Number.isFinite(qty) ||
              qty <= 0
            ) {
              return null;
            }

            const priceDiff = exitPrice - expectedPrice;
            const nominal = priceDiff * qty;
            const isLong = this.getDataValue('side') === Position.Side.LONG;
            const adjusted = isLong ? nominal : nominal * -1;

            return Number(adjusted.toFixed(8));
          },
        },
        riskReward: {
          type: DataTypes.VIRTUAL,
          get() {
            const entryPrice = toNumber(this.getDataValue('price'));
            const rawTpPrice = toNumber(this.getDataValue('tpPrice'));
            const rawSlPrice = toNumber(this.getDataValue('slPrice'));
            const exitPrice = toNumber(this.getDataValue('exitPrice'));

            if (
              !Number.isFinite(entryPrice) ||
              !Number.isFinite(rawTpPrice) ||
              !Number.isFinite(rawSlPrice)
            ) {
              return null;
            }

            let tpPrice = rawTpPrice;
            let slPrice = rawSlPrice;

            if (Number.isFinite(exitPrice)) {
              const diffToTp = Math.abs(exitPrice - rawTpPrice);
              const diffToSl = Math.abs(exitPrice - rawSlPrice);

              if (diffToTp <= diffToSl) {
                tpPrice = exitPrice;
              } else {
                slPrice = exitPrice;
              }
            }

            const reward = Math.abs(tpPrice - entryPrice);
            const risk = Math.abs(entryPrice - slPrice);

            if (
              !Number.isFinite(reward) ||
              !Number.isFinite(risk) ||
              reward <= 0 ||
              risk <= 0
            ) {
              return null;
            }

            const ratio = reward / risk;
            if (!Number.isFinite(ratio)) {
              return null;
            }

            return Number(ratio.toFixed(8));
          },
        },
      },
      {
        sequelize,
        tableName: 'positions',
        modelName: 'Position',
        underscored: true,
        timestamps: true,
        defaultScope: {
          order: [
            // 1) nulos primeiro
            [Sequelize.literal('(exit_time IS NULL)'), 'DESC'],

            // 2) quando nulo, ordena por created_at DESC
            [
              Sequelize.literal(
                'CASE WHEN exit_time IS NULL THEN created_at END'
              ),
              'DESC',
            ],

            // 3) quando NÃO nulo, ordena por exit_time DESC
            [
              Sequelize.literal(
                'CASE WHEN exit_time IS NOT NULL THEN exit_time END'
              ),
              'DESC',
            ],

            // desempate estável opcional
            ['id', 'DESC'],
          ],
        },
      }
    );

    return Position;
  }
}
