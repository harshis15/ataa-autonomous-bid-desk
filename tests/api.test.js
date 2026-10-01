import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(os.tmpdir(),'ataa-test-'));
const port=32000+Math.floor(Math.random()*1000);
const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),ATAA_DATA_DIR:dir,ENABLE_LIVE_AI:'false'},stdio:['ignore','pipe','pipe']});
await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Server exited '+code)));});
const base=`http://127.0.0.1:${port}/api`;
async function req(url,method='GET',body){return fetch(base+url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}
test('API enforces scope gate, mode validation, live configuration and upload mode',async()=>{
 const create=await req('/bids','POST',{name:'API fixture',customer:'Test',mode:'demo'});const b=await create.json();
 assert.equal((await req(`/bids/${b.id}/architect`,'POST',{})).status,400);
 assert.equal((await req(`/bids/${b.id}/approve`,'POST',{reviewer:'X',acknowledged:true})).status,400);
 assert.equal((await req(`/bids/${b.id}/mode`,'PATCH',{mode:'arbitrary'})).status,400);
 await req(`/bids/${b.id}/mode`,'PATCH',{mode:'live'});await req(`/bids/${b.id}/sample`,'POST',{});
 assert.equal((await req(`/bids/${b.id}/analyse`,'POST',{})).status,400);
 const health=await (await req('/health')).json();assert.equal(health.live_configured,false);assert.ok(!JSON.stringify(health).includes('API_KEY'));
});
test.after(async()=>{child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});});
