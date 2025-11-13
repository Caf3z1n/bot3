import 'dotenv/config';

const enableDebugRoutes =
  String(process.env.ENABLE_DEBUG_ROUTES ?? 'true').toLowerCase() === 'true';

const appConfig = {
  environment: process.env.NODE_ENV || 'development',
  enableDebugRoutes,
};

export default appConfig;
