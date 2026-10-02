import { createApiGate } from './gate.mjs';

function trustedRequest(request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (/^x-(?:user(?:-|$)|roles?(?:-|$)|nakwol-)/i.test(name)) headers.delete(name);
  return new Request(request, {headers});
}
function trustedPrincipal(value) {
  return Object.freeze({...value,scopes:Object.freeze([...value.scopes])});
}
function apiResponse(body, status) {
  return uncachedResponse(new Response(body,{status}));
}
function uncachedResponse(response) {
  const headers=new Headers(response.headers);
  for(const name of ['Cache-Control','CDN-Cache-Control','Cloudflare-CDN-Cache-Control','Surrogate-Control']) headers.set(name,'private, no-store, max-age=0');
  return new Response(response.body,{status:response.status,headers});
}
function acceptsResponse(response) {
  const mediaType=(response.headers.get('Content-Type') || '').split(';',1)[0].trim().toLowerCase();
  return response.status !== 101 && mediaType !== 'text/event-stream';
}

/** Authenticate only. Apply responseHeaders, including renewed cookies, to the final response. */
export async function authorizeRequest(request, {settings,...context}) {
  let principal, authenticatedRequest;
  const gate = createApiGate(settings);
  const response = await gate(request,{...context,apiHandler:(incoming,value)=>{
    principal=trustedPrincipal(value);authenticatedRequest=trustedRequest(incoming);return apiResponse(null,204);
  }});
  if (!principal || response.status !== 204) return {allowed:false,response};
  return {allowed:true,principal,request:authenticatedRequest,responseHeaders:new Headers(response.headers)};
}

/** Web-standard API hook. Row/resource authorization remains a service-owned callback. */
export function protectHandler(handler, {authorizeResource,...settings}) {
  if (typeof handler !== 'function' || (authorizeResource !== undefined && typeof authorizeResource !== 'function')) throw new TypeError('handler and authorizeResource must be functions');
  const gate=createApiGate(settings);
  return (request,context)=>gate(request,{...context,apiHandler:async(incoming,value)=>{
    const principal=trustedPrincipal(value), safeRequest=trustedRequest(incoming);
    if (authorizeResource && await authorizeResource(safeRequest,principal,context) !== true) return apiResponse(null,403);
    const response=await handler(safeRequest,principal,context);
    if (!(response instanceof Response)) throw new TypeError('protected handler must return Response');
    if (!acceptsResponse(response)) {await response.body?.cancel();return apiResponse(null,501);}
    return uncachedResponse(response);
  }});
}
