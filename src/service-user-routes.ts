import type { Hono } from 'hono';
import type { Env } from './types';
import { authenticateServiceActor,requireServiceOwner,requireManagementMutation,managementAuthenticatedAt } from './service-management-auth';
import { managementResponse } from './service-management-routes';
import { listServiceUsers,serviceUser,serviceUserDto } from './service-users';
import { actOnServiceUser,preregisterServiceUser,serviceUserOperation } from './service-user-actions';
import { ServiceManagementError } from './service-management-types';

export function registerServiceUserRoutes(app:Hono<{Bindings:Env}>) {
  const base='/developer/v1/apps/:clientId';
  app.get(base+'/users',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),client=(c.req.param('clientId')??'');await requireServiceOwner(c.env,actor,client);
    return listServiceUsers(c.env,client,c.req.query());
  }));
  app.get(base+'/users/:subject',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),client=(c.req.param('clientId')??'');await requireServiceOwner(c.env,actor,client);
    if(Object.keys(c.req.query()).length)throw new ServiceManagementError('INVALID_QUERY',400);
    return serviceUserDto(await serviceUser(c.env,client,(c.req.param('subject')??'')));
  }));
  app.post(base+'/users',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),client=(c.req.param('clientId')??'');await requireServiceOwner(c.env,actor,client);
    if(Object.keys(c.req.query()).length)throw new ServiceManagementError('INVALID_QUERY',400);
    return preregisterServiceUser(c.env,actor,client,await requireManagementMutation(c,actor,'users:'+client),await managementAuthenticatedAt(c,actor.userId));
  }));
  app.post(base+'/users/:subject/actions',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),client=(c.req.param('clientId')??'');await requireServiceOwner(c.env,actor,client);
    if(Object.keys(c.req.query()).length)throw new ServiceManagementError('INVALID_QUERY',400);
    return actOnServiceUser(c.env,actor,client,(c.req.param('subject')??''),await requireManagementMutation(c,actor,'users:'+client),await managementAuthenticatedAt(c,actor.userId));
  }));
  app.get(base+'/user-operations/:operationId',c=>managementResponse(c,async()=>{
    const actor=await authenticateServiceActor(c),client=(c.req.param('clientId')??'');await requireServiceOwner(c.env,actor,client);
    if(Object.keys(c.req.query()).length)throw new ServiceManagementError('INVALID_QUERY',400);
    return serviceUserOperation(c.env,client,(c.req.param('operationId')??''));
  }));
}
