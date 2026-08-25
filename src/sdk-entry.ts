import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectRoutes } from './connect';
import { registerConnectDeviceRoutes } from './connect-device';
import { registerConnectCliApiRoutes } from './connect-cli-api';

registerSdkRoutes(app);
registerConnectRoutes(app);
registerConnectDeviceRoutes(app);
registerConnectCliApiRoutes(app);

export default app;
