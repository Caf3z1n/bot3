const dotenv = require('dotenv');

dotenv.config();

const base = {
  dialect: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  logging: process.env.DB_LOGGING === 'true',
  define: {
    underscored: true,
    underscoredAll: true,
  },
};

module.exports = {
  development: { ...base },
  test: {
    ...base,
    database: process.env.DB_NAME_TEST || `${base.database}_test`,
    logging: false,
  },
  production: { ...base },
};
