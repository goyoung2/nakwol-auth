import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectAdminV02Routes } from './connect-admin-v02';
import { registerConnectRoutes } from './connect';
import { registerConnectDeviceRoutes } from './connect-device';
import { registerConnectCliApiRoutes } from './connect-cli-api';
import { registerConnectCliDistributionRoutes } from './connect-cli-distribution';

registerSdkRoutes(app);
registerConnectAdminV02Routes(app);
registerConnectRoutes(app);
registerConnectDeviceRoutes(app);
registerConnectCliApiRoutes(app);
registerConnectCliDistributionRoutes(app);

export default app;
