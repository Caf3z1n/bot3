import { getClient } from '../../utils/binanceClient.js';

class InfoController {
  async index(req, res) {
    const client = await getClient();
    const payload = await client.futuresLeverageBracket({ symbol: 'BNBUSDT' });

    return res.json({ payload });
  }
}

export default new InfoController();
