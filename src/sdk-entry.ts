import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectRoutes } from './connect';
import { registerConnectDeviceRoutes } from './connect-device';
import { registerConnectCliApiRoutes } from './connect-cli-api';
import { registerConnectCliDistributionRoutes } from './connect-cli-distribution';

registerSdkRoutes(app);
registerConnectRoutes(app);
registerConnectDeviceRoutes(app);
registerConnectCliApiRoutes(app);
registerConnectCliDistributionRoutes(app);

export default app;
