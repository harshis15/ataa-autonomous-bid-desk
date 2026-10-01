import fs from 'node:fs/promises';
import {schemas} from '../shared/schemas.js';
const files={scope:'01_Scope_Agent_Prompt.txt',bom:'02_BOM_Agent_Prompt.txt',architecture:'03_Plant_Architecture_Agent_Prompt.txt',services:'04_Service_Estimation_Agent_Prompt.txt'};
export function isLiveConfigured(){return process.env.ENABLE_LIVE_AI==='true'&&!!process.env.AZURE_OPENAI_API_KEY&&!!process.env.AZURE_OPENAI_ENDPOINT&&!!process.env.AZURE_OPENAI_DEPLOYMENT&&!process.env.AZURE_OPENAI_ENDPOINT.includes('YOUR-');}
export function azureURL(){
 const raw=process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/,'');
 if(!raw)throw Error('Set AZURE_OPENAI_ENDPOINT in .env.');
 const url=new URL(raw);
 if(url.protocol!=='https:')throw Error('Azure endpoint must use HTTPS.');
 if(url.pathname.includes('/projects/'))throw Error('Use the Azure OpenAI resource endpoint, not a Foundry project URL.');
 return raw.endsWith('/openai/v1')?`${raw}/chat/completions`:`${raw}/openai/v1/chat/completions`;
}
export async function callAgent(stage,input,validationFeedback=null,options={}){
 if(!isLiveConfigured())throw Error('Live AI is disabled. Configure the Azure resource endpoint, deployment and key, then set ENABLE_LIVE_AI=true and restart the server.');
 const prompt=options.prompt ?? await fs.readFile(new URL(`../prompts/${files[stage]}`,import.meta.url),'utf8');
 const response=await fetch(azureURL(),{method:'POST',signal:AbortSignal.timeout(Number(process.env.AZURE_TIMEOUT_MS)||120000),headers:{'Content-Type':'application/json','api-key':process.env.AZURE_OPENAI_API_KEY},body:JSON.stringify({model:process.env.AZURE_OPENAI_DEPLOYMENT,messages:[{role:'system',content:prompt+'\nExact JSON Schema (required):\n'+JSON.stringify(schemas[stage])},{role:'user',content:JSON.stringify({input,...(validationFeedback?{validation_feedback:validationFeedback}: {})})}],response_format:{type:'json_object'},max_completion_tokens:Number(process.env.AZURE_MAX_COMPLETION_TOKENS)||12000})});
 if(!response.ok){const id=response.headers.get('apim-request-id')||'unavailable';throw Error(`Azure returned HTTP ${response.status}. Check deployment, endpoint, model JSON support and quota. Request ID: ${id}`);}
 const data=await response.json();const choice=data.choices?.[0];
 if(choice?.finish_reason==='length')throw Error('Azure output was truncated. Increase AZURE_MAX_COMPLETION_TOKENS or reduce the RFQ size.');
 if(choice?.message?.refusal)throw Error('The model declined this request.');
 try{return JSON.parse(choice?.message?.content||'');}catch{throw Error('Azure returned invalid JSON. Try again or use Demo mode.');}
}
