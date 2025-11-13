import { Op } from 'sequelize';
import Position from '../models/Position.js';
import { initDatabase } from '../index.js';

function sanitizeDecimal(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function createPosition(data) {
  if (!data?.symbol) {
    throw new Error('createPosition requires a symbol');
  }

  if (!data?.side) {
    throw new Error('createPosition requires a side');
  }

  await initDatabase();

  const payload = {
    symbol: data.symbol,
    side: data.side,
    status: data.status ?? Position.Status.OPEN,
    orderId: data.orderId ?? null,
    tpOrderId: data.tpOrderId ?? null,
    slOrderId: data.slOrderId ?? null,
    candleCrossTime: data.candleCrossTime ?? null,
    fees: sanitizeDecimal(data.fees),
    price: sanitizeDecimal(data.price),
    tpPrice: sanitizeDecimal(data.tpPrice),
    slPrice: sanitizeDecimal(data.slPrice),
    notional: sanitizeDecimal(data.notional),
    qty: sanitizeDecimal(data.qty),
    exitTime: data.exitTime ?? null,
    exitPrice: sanitizeDecimal(data.exitPrice),
    pnl: sanitizeDecimal(data.pnl),
  };

  const position = await Position.create(payload);
  return position.get({ plain: true });
}

export async function findPositionById(id) {
  if (!id) {
    throw new Error('findPositionById requires an id');
  }

  await initDatabase();
  const position = await Position.findByPk(id);
  return position ? position.get({ plain: true }) : null;
}

export async function listPositions(filters = {}) {
  await initDatabase();

  const where = {};
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.symbol) {
    where.symbol = filters.symbol;
  }

  const positions = await Position.findAll({
    where,
    order: [['createdAt', 'DESC']],
  });

  return positions.map((position) => position.get({ plain: true }));
}

export async function updatePosition(id, changes = {}) {
  if (!id) {
    throw new Error('updatePosition requires an id');
  }

  await initDatabase();

  const payload = {
    ...(changes.symbol !== undefined ? { symbol: changes.symbol } : {}),
    ...(changes.side !== undefined ? { side: changes.side } : {}),
    ...(changes.status !== undefined ? { status: changes.status } : {}),
    ...(changes.orderId !== undefined ? { orderId: changes.orderId } : {}),
    ...(changes.tpOrderId !== undefined
      ? { tpOrderId: changes.tpOrderId }
      : {}),
    ...(changes.slOrderId !== undefined
      ? { slOrderId: changes.slOrderId }
      : {}),
    ...(changes.candleCrossTime !== undefined
      ? { candleCrossTime: changes.candleCrossTime }
      : {}),
    ...(changes.fees !== undefined
      ? { fees: sanitizeDecimal(changes.fees) }
      : {}),
    ...(changes.price !== undefined
      ? { price: sanitizeDecimal(changes.price) }
      : {}),
    ...(changes.tpPrice !== undefined
      ? { tpPrice: sanitizeDecimal(changes.tpPrice) }
      : {}),
    ...(changes.slPrice !== undefined
      ? { slPrice: sanitizeDecimal(changes.slPrice) }
      : {}),
    ...(changes.notional !== undefined
      ? { notional: sanitizeDecimal(changes.notional) }
      : {}),
    ...(changes.qty !== undefined ? { qty: sanitizeDecimal(changes.qty) } : {}),
    ...(changes.exitTime !== undefined ? { exitTime: changes.exitTime } : {}),
    ...(changes.exitPrice !== undefined
      ? { exitPrice: sanitizeDecimal(changes.exitPrice) }
      : {}),
    ...(changes.pnl !== undefined ? { pnl: sanitizeDecimal(changes.pnl) } : {}),
  };

  if (Object.keys(payload).length === 0) {
    return findPositionById(id);
  }

  await Position.update(payload, { where: { id } });
  return findPositionById(id);
}

export async function findPositionByOrderId(orderId) {
  if (orderId === undefined || orderId === null || orderId === '') {
    throw new Error('findPositionByOrderId requires an orderId');
  }

  await initDatabase();
  const position = await Position.findOne({
    where: { orderId: String(orderId) },
  });

  return position ? position.get({ plain: true }) : null;
}

export async function findPositionByAnyOrderId(orderId) {
  if (orderId === undefined || orderId === null || orderId === '') {
    throw new Error('findPositionByAnyOrderId requires an orderId');
  }

  await initDatabase();
  const normalized = String(orderId);
  const position = await Position.findOne({
    where: {
      [Op.or]: [
        { orderId: normalized },
        { tpOrderId: normalized },
        { slOrderId: normalized },
      ],
    },
  });

  if (!position) {
    return { position: null, matchType: null };
  }

  const plain = position.get({ plain: true });
  let matchType = 'entry';
  if (plain.tpOrderId === normalized) {
    matchType = 'tp';
  } else if (plain.slOrderId === normalized) {
    matchType = 'sl';
  }

  return { position: plain, matchType };
}
