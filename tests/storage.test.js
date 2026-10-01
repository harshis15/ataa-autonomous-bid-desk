import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Repository,acquireLock} from '../server/storage/database.js';
import {LocalFileStore} from '../server/storage/files.js';
const fixture=()=>({id:'fixture',name:'Legacy project',status:'Draft',mode:'demo',updated_at:new Date().toISOString(),audit:[],busy:false,results:{}});
test('legacy import is repeatable, keeps the original and rolls back duplicate IDs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ataa-import-'));const repo=new Repository(dir);
 try{
  const raw=JSON.stringify([fixture(),fixture()]);fs.writeFileSync(path.join(dir,'bids.json'),raw);
  assert.throws(()=>repo.migrateLegacy(),/already exists/);assert.equal(repo.stats().bids,0);
  const good=JSON.stringify([fixture()]);fs.writeFileSync(path.join(dir,'bids.json'),good);
  repo.migrateLegacy();repo.migrateLegacy();assert.equal(repo.stats().bids,1);assert.equal(repo.stats().bid_revisions,1);
  assert.equal(fs.readFileSync(path.join(dir,'bids.json'),'utf8'),good);
 }finally{repo.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('revision conflict rolls back job checkpoint; old revisions and file hashes remain verifiable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ataa-store-'));const repo=new Repository(dir);const files=new LocalFileStore(path.join(dir,'objects'));
 try{
  const b=fixture();repo.saveBid(b,'Created');const stale=structuredClone(b);b.name='Edited';repo.saveBid(b,'Edited');
  assert.throws(()=>repo.saveBid(stale,'Stale',{job:{id:'wrong',bid_id:b.id,status:'complete',created_at:'now'}}),/Project changed/);
  assert.equal(repo.getJob('wrong'),null);assert.equal(repo.revision(b.id,1).name,'Legacy project');assert.equal(repo.getBid(b.id).name,'Edited');
  const a=files.put(Buffer.from('Exact original bytes'),{bid_id:b.id,name:'../../rfq.txt',kind:'source',mime:'text/plain'});repo.addArtifact(a,b.revision);
  assert.equal(a.name,'rfq.txt');assert.equal(files.read(a).toString(),'Exact original bytes');
  assert.throws(()=>files.resolve('../escape'),/Invalid/);
  fs.writeFileSync(files.resolve(a.key),'tampered');assert.throws(()=>files.read(a),/integrity/);
  const release=acquireLock(dir);assert.throws(()=>acquireLock(dir),/already in use/);release();
 }finally{repo.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('interrupted Live runs require acknowledgment and reject changed deployment configuration',async()=>{
 const {Orchestrator}=await import('../server/orchestrator.js');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ataa-live-recovery-'));const repo=new Repository(dir);
 const names=['ENABLE_LIVE_AI','AZURE_OPENAI_API_KEY','AZURE_OPENAI_ENDPOINT','AZURE_OPENAI_DEPLOYMENT','AZURE_MAX_COMPLETION_TOKENS'];const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 try{
  process.env.ENABLE_LIVE_AI='true';process.env.AZURE_OPENAI_API_KEY='test-placeholder';process.env.AZURE_OPENAI_ENDPOINT='https://example.openai.azure.com';process.env.AZURE_OPENAI_DEPLOYMENT='test-deployment';process.env.AZURE_MAX_COMPLETION_TOKENS='12000';
  const b={...fixture(),mode:'live',active_job_id:'live-job',busy:true};const j={id:'live-job',bid_id:b.id,created_at:'2026-10-01',status:'running',mode:'live',engine_version:'same-code',deployment:'test-deployment',endpoint:process.env.AZURE_OPENAI_ENDPOINT,max_completion_tokens:12000,stages:['scope'],events:[{stage:'scope',status:'running'}]};repo.saveBid(b,'Started',{job:j});
  const record=(b,action,detail,options)=>{b.audit.push({at:new Date().toISOString(),action,detail});repo.saveBid(b,action,options);};const flow=new Orchestrator({repository:repo,record,referenceId:'test',engineVersion:'same-code'});
  flow.recover();let restored=repo.getBid(b.id);assert.equal(restored.recovery_pending,true);assert.equal(repo.getJob(j.id).status,'interrupted');
  assert.throws(()=>flow.resume(restored,false),/Acknowledge/);
  process.env.AZURE_OPENAI_DEPLOYMENT='changed-deployment';assert.throws(()=>flow.resume(restored,true),/configuration changed/);
  flow.engineVersion='new-code';assert.throws(()=>flow.resume(restored,true),/code changed/);
  flow.discard(restored);assert.equal(repo.getJob(j.id).status,'cancelled');assert.equal(repo.getBid(b.id).recovery_pending,false);
 }finally{for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}repo.close();fs.rmSync(dir,{recursive:true,force:true});}
});
