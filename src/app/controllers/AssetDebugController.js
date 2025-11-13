import { listAssets } from '../../database/repositories/assetRepository.js';
import Asset from '../../database/models/Asset.js';
import { initDatabase } from '../../database/index.js';

class AssetDebugController {
  static async index(req, res) {
    const assets = await listAssets();
    return res.json({ assets });
  }

  static async update(req, res) {
    await initDatabase();
    const symbol = req.query?.symbol ?? null;

    if (!symbol) {
      return res.status(400).json({
        error: 'Missing symbol query parameter (e.g., ?symbol=BTCUSDT)',
      });
    }

    const asset = await Asset.findOne({ where: { symbol } });
    if (!asset) {
      return res.status(404).json({
        error: `Asset with symbol ${symbol} not found`,
      });
    }

    await asset.update({
      candleCrossTime: new Date(),
    });
    return res.json({ asset });
  }
}

export default AssetDebugController;
