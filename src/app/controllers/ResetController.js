import { resetBotState } from '../services/botResetService.js';
import logger from '../../utils/logger.js';

class ResetController {
  static async destroy(req, res) {
    try {
      const summary = await resetBotState({ logger });
      return res.status(200).json({ summary });
    } catch (error) {
      logger.error({ err: error }, '[ResetController] Falha ao resetar estado');
      return res.status(500).json({
        error: 'Falha ao resetar estado do bot',
        details: error.message,
      });
    }
  }
}

export default ResetController;
