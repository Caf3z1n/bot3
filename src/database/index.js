import { Sequelize } from 'sequelize';

import databaseConfig from '../config/database.cjs';
import Asset from './models/Asset.js';
import Position from './models/Position.js';

const registry = [Asset, Position];

let connection;
let modelsInitialised = false;

function resolveConfig() {
  const environment = process.env.NODE_ENV ?? 'development';
  const config = databaseConfig[environment];

  if (!config) {
    throw new Error(
      `Database config not found for environment "${environment}"`
    );
  }

  return config;
}

export async function initDatabase() {
  if (connection) {
    return connection;
  }

  const config = resolveConfig();

  connection = new Sequelize(
    config.database,
    config.username,
    config.password,
    config
  );
  await connection.authenticate();
  await connection.query('SELECT 1');

  if (!modelsInitialised) {
    registry.forEach((model) => {
      model.initialize(connection);
    });

    registry.forEach((model) => {
      if (typeof model.associate === 'function') {
        model.associate(connection.models);
      }
    });

    modelsInitialised = true;
  }

  return connection;
}

export function getConnection() {
  if (!connection) {
    throw new Error('Database not initialised. Call initDatabase() first.');
  }

  return connection;
}
