import app from './index';
import { registerSdkRoutes } from './sdk';
import { registerConnectRoutes } from './connect';
import { registerConnectCliRoutes } from './connect-cli-routes';
import { registerConnectCliAppRoutes } from './connect-cli-apps';
import { registerConnectDeveloperAdminRoutes } from './connect-admin-developers';
import { registerConnectCliDistributionRoutes } from './connect-cli-distribution';

registerSdkRoutes(app);
registerConnectRoutes(app);
registerConnectCliRoutes(app);
registerConnectCliAppRoutes(app);
registerConnectDeveloperAdminRoutes(app);
registerConnectCliDistributionRoutes(app);

export default app;
