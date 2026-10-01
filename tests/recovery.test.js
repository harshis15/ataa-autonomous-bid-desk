import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){for(let i=0;i<300;i++){const x=await fn();if(x)return x;await delay(25);}throw Error('Timed out waiting for workflow condition');}

test('crash recovery keeps BOM checkpoint, original files, approved revision and archived PDF across restart',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ataa-recovery-'));const port=33500+Math.floor(Math.random()*500);let child;
 const base=`http://127.0.0.1:${port}/api`;
 const req=async(url,method='GET',body)=>{const r=await fetch(base+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const x=await r.json();assert.ok(r.ok,JSON.stringify(x));return x;};
 async function start(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),ATAA_DATA_DIR:dir,ENABLE_LIVE_AI:'false'},stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',x=>stderr+=x);await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',c=>reject(Error('Server exited '+c+' '+stderr)));});}
 async function stop(signal='SIGTERM'){const c=child;child=null;if(c&&c.exitCode===null){const done=new Promise(r=>c.once('exit',r));c.kill(signal);await done;}}
 try{
  await start();let b=await req('/bids','POST',{name:'Recovery project',customer:'Synthetic',mode:'demo'});
  b=await req(`/bids/${b.id}/sample`,'POST',{});const artifact=b.document.artifact_id;
  const source=await (await fetch(base+`/bids/${b.id}/artifacts/${artifact}`)).text();assert.equal(source,b.document.text);
  const other=await req('/bids','POST',{name:'Other project',customer:'Synthetic',mode:'demo'});
  assert.equal((await fetch(base+`/bids/${other.id}/artifacts/${artifact}`)).status,404);
  const scopeJob=await req(`/bids/${b.id}/analyse`,'POST',{});await waitFor(async()=>{const j=await req('/jobs/'+scopeJob.job_id);return j.status==='complete';});
  b=await req('/bids/'+b.id);b=await req(`/bids/${b.id}/scope`,'PATCH',{scope:b.scope,confirm:true});
  const run=await req(`/bids/${b.id}/architect`,'POST',{});
  const checkpoint=await waitFor(async()=>{const j=await req('/jobs/'+run.job_id);return j.events[0].status==='complete'&&j.events[1].status==='running'?j:null;});
  await stop('SIGKILL');await start();
  b=await req('/bids/'+b.id);assert.equal(b.recovery_pending,true);assert.equal(b.busy,false);assert.ok(b.results.bom);assert.equal(b.results.architecture,undefined);
  assert.equal((await fetch(base+`/bids/${b.id}/mode`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'live'})})).status,409);
  const resume=await req(`/bids/${b.id}/resume`,'POST',{});assert.equal(resume.job_id,run.job_id);
  const complete=await waitFor(async()=>{const j=await req('/jobs/'+run.job_id);return j.status==='complete'?j:null;});
  assert.equal(complete.events[0].finished_at,checkpoint.events[0].finished_at);
  b=await req('/bids/'+b.id);assert.equal(b.results.services.total_hours,195.8);
  b=await req(`/bids/${b.id}/approve`,'POST',{reviewer:'Test reviewer',notes:'Synthetic conditional approval.',acknowledged:true});
  assert.equal(b.approval.revision,b.revision);
  const pdf1=await fetch(base+`/bids/${b.id}/pdf`);assert.match(pdf1.headers.get('content-disposition'),/Recovery project/);const bytes=Buffer.from(await pdf1.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  const stored=await req(`/bids/${b.id}/data`);assert.ok(stored.revisions.length>5);const report=stored.artifacts.find(a=>a.kind==='report');assert.equal(report.revision,b.revision);
  await stop();await start();
  const pdf2=Buffer.from(await (await fetch(base+`/bids/${b.id}/pdf`)).arrayBuffer());assert.deepEqual(pdf2,bytes);
  const reopened=await req('/bids/'+b.id);assert.equal(reopened.approval.revision,b.revision);
  const saved=await req(`/bids/${b.id}/revisions/${b.revision}`);assert.equal(saved.approval.reviewer,'Test reviewer');
  assert.equal((await fetch(base+`/bids/${b.id}/sample`,{method:'POST'})).status,409);
 }finally{await stop();await fs.rm(dir,{recursive:true,force:true});}
});

test('uploaded RFQ bytes survive a mode reset and an offline backup can restore the workspace',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ataa-upload-'));const backup=dir+'-backup';let child;const port=34500+Math.floor(Math.random()*500);const base=`http://127.0.0.1:${port}/api`;
 const request=async(url,method='GET',body)=>{const r=await fetch(base+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});assert.ok(r.ok);return r.json();};
 const start=async location=>{child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),ATAA_DATA_DIR:location,ENABLE_LIVE_AI:'false'},stdio:['ignore','pipe','pipe']});await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(Error('Server exit '+c)));});};
 const stop=async()=>{if(child){const c=child;child=null;const done=new Promise(r=>c.once('exit',r));c.kill();await done;}};
 try{
  await start(dir);let b=await request('/bids','POST',{name:'Upload project',customer:'Test',mode:'live'});
  const original='Customer RFQ: supply a redundant SCADA system with twelve cabinets.\r\n';const body=new FormData();body.append('file',new Blob([original],{type:'text/plain'}),'rfq.txt');
  const uploaded=await fetch(base+`/bids/${b.id}/document`,{method:'POST',body});assert.equal(uploaded.status,200);b=await uploaded.json();const id=b.document.artifact_id;
  await request(`/bids/${b.id}/mode`,'PATCH',{mode:'demo'});assert.equal((await request('/bids/'+b.id)).document,null);
  assert.equal(await (await fetch(base+`/bids/${b.id}/artifacts/${id}`)).text(),original);
  await stop();
  const command=spawn(process.execPath,['scripts/backup.js',backup],{env:{...process.env,ATAA_DATA_DIR:dir},stdio:'pipe'});assert.equal(await new Promise(r=>command.once('exit',r)),0);
  await start(backup);assert.equal((await request('/bids/'+b.id)).name,'Upload project');assert.equal(await (await fetch(base+`/bids/${b.id}/artifacts/${id}`)).text(),original);
 }finally{await stop();await fs.rm(dir,{recursive:true,force:true});await fs.rm(backup,{recursive:true,force:true});}
});
