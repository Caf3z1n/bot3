import { Router } from 'express';
import appConfig from './config/app.js';

import AssetController from './app/controllers/AssetController.js';
import PositionController from './app/controllers/PositionController.js';
import CandleController from './app/controllers/CandleController.js';
import AssetDebugController from './app/controllers/AssetDebugController.js';
import InfoController from './app/controllers/InfoController.js';
import BinanceOrderController from './app/controllers/BinanceOrderController.js';
import PositionDebugController from './app/controllers/PositionDebugController.js';
import ResetController from './app/controllers/ResetController.js';

const routes = Router();

routes.get('/assets', AssetController.index);
routes.put('/assets', AssetController.update);
routes.get('/binance/open-orders', BinanceOrderController.listOpen);
routes.get('/positions', PositionController.index);
routes.delete('/reset', ResetController.destroy);

if (appConfig.enableDebugRoutes) {
  routes.get('/debug/candles', CandleController.index);

  routes.get('/debug/assets', AssetDebugController.index);
  routes.put('/debug/assets/update', AssetDebugController.update);

  routes.get('/debug/info', InfoController.index);
  routes.delete(
    '/debug/binance/open-orders',
    BinanceOrderController.cancelOpen
  );
  routes.get('/debug/binance/order/:orderId?', BinanceOrderController.show);
  routes.get('/debug/positions/:orderId?/fees', PositionDebugController.fees);
  routes.get('/debug/positions/order/:orderId?', PositionDebugController.order);
}

export default routes;
