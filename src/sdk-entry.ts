import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectRoutes } from './connect';
import { registerConnectDeviceRoutes } from './connect-device';

registerSdkRoutes(app);
registerConnectRoutes(app);
registerConnectDeviceRoutes(app);

export default app;
