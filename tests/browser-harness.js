import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
export {expect};
const cases=[];
export const test=(name,fn)=>cases.push({name,fn});
export async function run(){
 await fs.mkdir('runtime/e2e',{recursive:true});const dir=await fs.mkdtemp('runtime/e2e-run-');
 const server=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'3099',ATAA_DATA_DIR:dir,ENABLE_LIVE_AI:'false'},stdio:['ignore','pipe','pipe']});
 let browser;let stderr='';server.stderr.on('data',x=>stderr+=x);
 try{await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('Test server exited early: '+stderr)));});
 browser=await chromium.launch({headless:true});
 const selected=cases.filter(t=>!process.env.ATAA_TEST_FILTER||t.name.includes(process.env.ATAA_TEST_FILTER));
 for(const [i,t] of selected.entries()){
 const page=await browser.newPage({viewport:{width:1440,height:1000},baseURL:'http://127.0.0.1:3099'});
 try{await t.fn({page});await page.screenshot({path:`${dir}/check-${i+1}.png`,fullPage:true});console.log(`PASS ${t.name}`);}catch(e){await page.screenshot({path:`${dir}/failed-${i+1}.png`,fullPage:true});throw e;}finally{await page.close();}
 }
 console.log(`${selected.length} browser workflow checks passed. Screenshots: ${dir}`);
 }finally{await browser?.close();if(server.exitCode===null){const exited=new Promise(r=>server.once('exit',r));server.kill();await exited;}}
}
