import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectRoutes } from './connect';
import { registerConnectCliRoutes } from './connect-cli-routes';

registerSdkRoutes(app);
registerConnectRoutes(app);
registerConnectCliRoutes(app);

export default app;
