import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectRoutes } from './connect';

registerSdkRoutes(app);
registerConnectRoutes(app);

export default app;
