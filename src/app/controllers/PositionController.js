import { listPositions } from '../../database/repositories/positionsRepository.js';

class PositionController {
  static async index(req, res) {
    const positions = await listPositions();

    return res.json({ positions });
  }
}

export default PositionController;
