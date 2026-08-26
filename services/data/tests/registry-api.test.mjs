import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRegistrySeed } from '../scripts/registry-seed-file.mjs';
import { DatabaseSync } from 'node:sqlite';
import { buildRegistrySql } from '../scripts/seed-registry.mjs';
import { listRegistry, getRegistrySummary } from '../src/store.ts';

class Bound { constructor(stmt,values){this.stmt=stmt;this.values=values;} async all(){return {results:this.stmt.all(...this.values)}} async first(){return this.stmt.get(...this.values)??null} async run(){return this.stmt.run(...this.values)} }
class Prep { constructor(db,sql){this.db=db;this.sql=sql;} bind(...v){return new Bound(this.db.prepare(this.sql),v)} async all(){return {results:this.db.prepare(this.sql).all()}} async first(){return this.db.prepare(this.sql).get()??null} }
function d1(db){return {prepare:(sql)=>new Prep(db,sql)}};
const base=new URL('../',import.meta.url);
const seed=await readRegistrySeed();
const m1=await readFile(new URL('migrations/0001_initial.sql',base),'utf8');
const m2=await readFile(new URL('migrations/0002_registry_v02.sql',base),'utf8');
function ready(){const db=new DatabaseSync(':memory:');db.exec(m1);db.exec(m2);db.exec(buildRegistrySql(seed));return {db,env:{DB:d1(db)}};}

test('general registry defaults to visible rows and can include preserved hidden rows',async()=>{
 const {env}=ready();
 const visible=await listRegistry(env,'generals',{includeHidden:false});
 const all=await listRegistry(env,'generals',{includeHidden:true});
 assert.equal(visible.length,140); assert.equal(all.length,209);
 const cao=visible.find((x)=>x.id==='g:1000'); assert.equal(cao.native_id,1000); assert.equal(cao.unique_tactic_id,'t:100001'); assert.equal(cao.metadata.unique_tactic_name,'난세의 간웅');
});

test('registry exposes equipment, stats, formations and warbooks already present in source kit',async()=>{
 const {env}=ready();
 assert.equal((await listRegistry(env,'equipment')).length,134);
 assert.equal((await listRegistry(env,'stats')).length,281);
 assert.equal((await listRegistry(env,'formations')).length,8);
 assert.equal((await listRegistry(env,'warbooks')).length,442);
 assert.equal((await listRegistry(env,'formations')).find((x)=>x.id==='f:101').name,'일자진');
});

test('registry summary reports actual database counts and source seed metadata',async()=>{
 const {env}=ready(); const s=await getRegistrySummary(env);
 assert.equal(s.seed_version,'0.2.0'); assert.equal(s.schema_version,2); assert.equal(s.counts.generals,209); assert.equal(s.counts.generals_enabled,140); assert.equal(s.counts.warbooks,442); assert.equal(s.source.lifecycle,'AUTHORITATIVE');
});
