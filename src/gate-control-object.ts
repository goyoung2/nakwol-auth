export interface ControlProjection {
  readonly clientId:string;
  readonly version:number;
  readonly appStatus:string;
  readonly policyFloor:number;
  readonly appEpoch:number;
  readonly revocations:readonly string[];
}
export class GateControlObject {
  constructor(private readonly state:DurableObjectState) {}
  async fetch(request:Request):Promise<Response> {
    const path=new URL(request.url).pathname;
    if(path==='/publish' && request.method==='POST') {
      const incoming=await request.json<ControlProjection>();
      return this.state.storage.transaction(async storage=>{
        const current=await storage.get<ControlProjection>('projection');
        if(!current || incoming.version>current.version) await storage.put('projection',incoming);
        return Response.json({version:Math.max(current?.version??0,incoming.version)});
      });
    }
    const projection=await this.state.storage.get<ControlProjection>('projection');
    return projection?Response.json(projection):new Response(null,{status:503});
  }
}
