import test from 'node:test';
import assert from 'node:assert/strict';
import {callAgent,azureURL,isLiveConfigured} from '../server/azure.js';
test('Azure adapter builds a v1 request and keeps credential in server-only header',async()=>{
 const oldFetch=globalThis.fetch;
 Object.assign(process.env,{ENABLE_LIVE_AI:'true',AZURE_OPENAI_ENDPOINT:'https://example-resource.openai.azure.com',AZURE_OPENAI_DEPLOYMENT:'example-deployment',AZURE_OPENAI_API_KEY:'test-only-placeholder'});
 assert.equal(isLiveConfigured(),true);assert.equal(azureURL(),'https://example-resource.openai.azure.com/openai/v1/chat/completions');
 let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"rule_ids":[],"notes":[]}'}}]}),{status:200});};
 try{assert.deepEqual(await callAgent('services',{scope:{}}),{rule_ids:[],notes:[]});const body=JSON.parse(captured.options.body);assert.equal(body.model,'example-deployment');assert.equal(body.response_format.type,'json_object');assert.equal(captured.options.headers['api-key'],'test-only-placeholder');assert.ok(!captured.options.body.includes('test-only-placeholder'));assert.equal(body.messages[0].role,'system');assert.equal(body.messages[1].role,'user');}
 finally{globalThis.fetch=oldFetch;for(const k of ['ENABLE_LIVE_AI','AZURE_OPENAI_ENDPOINT','AZURE_OPENAI_DEPLOYMENT','AZURE_OPENAI_API_KEY'])delete process.env[k];}
});
