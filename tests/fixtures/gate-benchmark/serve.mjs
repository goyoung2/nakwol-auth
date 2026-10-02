// Public synthetic fixture for browser decoding QA only. Never serve production assets.
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {generateFixture} from './generator.mjs';
const fixture=generateFixture({imageKiB:Number(process.argv[2]??50),seed:'nakwol-t11-731'});
const server=createServer((request,response)=>{
  const path=new URL(request.url,'http://localhost').pathname;
  const asset=fixture.assets.get(path==='/'?'/index.html':path);
  if(!asset){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'Content-Type':asset.contentType,'Cache-Control':'no-store'});response.end(asset.body);
});
server.listen(0,'127.0.0.1',async()=>{
  const url='http://127.0.0.1:'+server.address().port+'/';
  if(process.argv[3])await writeFile(process.argv[3],url);
  process.stdout.write(url+'\n');
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
