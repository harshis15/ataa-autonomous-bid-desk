import catalog from '../data/ProductCatalog.json';
import projects from '../data/HistoricalProjects.json';
import serviceRules from '../data/ServiceRules.json';
import scope from '../data/SampleScope.json';
import bom from '../data/SampleBOM.json';
import architecture from '../data/SampleArchitecture.json';
import sampleText from '../public/samples/AlphaEnergy_SCADA_RFQ.txt?raw';
import {validate,runStage} from './demoWorkflow.js';
import {stageLabels} from '../shared/schemas.js';
import {rankProjects,baselineDelta,priceBOM,assertReferences} from '../shared/engine.js';
const rules=serviceRules.rules,refs={catalog,projects,rules,fixtures:{scope,bom,architecture}};
const KEY='ataa-browser-demo-v1', referenceId='bundled-v3-demo',engineVersion='browser-demo-v1';
const clone=x=>structuredClone(x),now=()=>new Date().toISOString();
const liveError='Live AI is available locally: run npm run dev with Azure configured in the server .env file. Switch back to Demo for this hosted workspace.';
function load(){try{return JSON.parse(localStorage.getItem(KEY)||'null')||{bids:{},revisions:{},jobs:{}};}catch{throw Error('Browser demo storage cannot be read. Enable site storage or use another browser profile.');}}
function persist(s){try{localStorage.setItem(KEY,JSON.stringify(s));}catch{throw Error('Browser storage is full or unavailable. This change was not saved. Export existing projects or use another browser profile.');}}
function audit(s,b,action,detail){b.updated_at=now();b.revision=(b.revision||0)+1;b.audit.push({at:b.updated_at,action,detail});s.bids[b.id]=b;(s.revisions[b.id]??=[]).push({revision:b.revision,reason:action,created_at:b.updated_at,snapshot:clone(b)});}
function clearDownstream(b){b.confirmed=false;b.workflow=null;b.results={};b.baseline=null;b.matches=[];b.approval=null;b.status='Scope review';b.active_job_id=null;b.recovery_pending=false;}
function editable(b){if(b.approval)throw Error('Approved snapshot is locked. Create a new bid to revise.');if(b.busy)throw Error('A workflow is running. Wait for it to finish.');}
export async function demoApi(url,method='GET',body={}){
 const s=load();
 if(url==='/bootstrap')return clone({catalog,projects:projects.map(({bom,...p})=>p),rules,live_configured:false});
 if(url==='/storage')return {provider:'Browser localStorage',counts:{bids:Object.keys(s.bids).length,bid_revisions:Object.values(s.revisions).flat().length,audit_events:Object.values(s.bids).reduce((n,b)=>n+b.audit.length,0),jobs:Object.keys(s.jobs).length,artifacts:0,reference_versions:1},retention:'Demo projects, revisions and audit history stay in this browser for this site until its site data is cleared. They are not shared across devices.',access:'Single-browser demo storage. PDF and JSON files are generated on download.',backup:'Download project JSON snapshots to keep a separate copy.'};
 if(url==='/bids'){
  if(method==='GET')return Object.values(s.bids).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  if(method!=='POST')throw Error('Unsupported operation.');
  const {name,customer,mode='demo'}=body;
  if(!['demo','live'].includes(mode)||!name?.trim()||!customer?.trim()||name.length>200||customer.length>200)throw Error('Project name, customer and valid mode are required (maximum 200 characters).');
  if(mode==='live')throw Error(liveError);
  const b={id:crypto.randomUUID(),name:name.trim(),customer:customer.trim(),mode,status:'Draft',created_at:now(),updated_at:now(),document:null,scope:null,confirmed:false,workflow:null,results:{},baseline:null,matches:[],approval:null,audit:[],busy:false};
  audit(s,b,'Bid created','Demo mode; browser workspace');persist(s);return clone(b);
 }
 if(url.startsWith('/jobs/')){const j=s.jobs[url.split('/')[2]];if(!j)throw Error('Run not found.');return clone(j);}
 const [,resource,id,action]=url.split('/');const b=s.bids[id];
 if(resource!=='bids'||!b)throw Error('Bid not found.');
 if(method==='GET'){
  if(!action)return clone(b);
  if(action==='data')return {revision:b.revision,document:b.document?{name:b.document.name,artifact_id:'bundled-sample'}:null,artifacts:[],revisions:(s.revisions[id]||[]).map(({snapshot,...r})=>r).reverse(),jobs:Object.values(s.jobs).filter(j=>j.bid_id===id),browser_demo:true};
  throw Error('Unsupported demo read.');
 }
 editable(b);
 const save=(action,detail)=>audit(s,b,action,detail);
 if(action==='mode'){
  if(body.mode==='live')throw Error(liveError);
  if(body.mode!=='demo')throw Error('Invalid mode.');
  b.mode='demo';b.scope=null;b.document=null;clearDownstream(b);b.status='Draft';save('Mode changed','Demo; generated outputs cleared.');
 }else if(action==='sample'){
  b.document={name:'AlphaEnergy_SCADA_RFQ.txt',text:sampleText,sample:true};b.scope=null;clearDownstream(b);b.status='Ready to analyse';save('Sample loaded','Synthetic Alpha Energy RFQ');
 }else if(action==='document')throw Error('Demo mode uses the bundled sample RFQ. Use local Live AI for your own document.');
 else if(action==='analyse'||action==='architect'){
  if(action==='analyse'&&!b.document)throw Error('Load the sample RFQ first.');
  if(action==='architect'&&!b.confirmed)throw Error('Confirm scope first.');
  if(action==='analyse'){clearDownstream(b);b.scope=null;}else{b.workflow='architect';b.results={};b.baseline=null;b.matches=[];}
  const stages=action==='analyse'?['scope']:['bom','architecture','services'];
  const j={id:crypto.randomUUID(),bid_id:id,stages,status:'running',created_at:now(),reference_id:referenceId,events:stages.map(stage=>({stage,label:stageLabels[stage],status:'pending',attempts:0}))};
  b.active_job_id=j.id;b.provenance={reference_id:referenceId,engine_version:engineVersion};
  // Commit only a completed or failed run: a page reload cannot leave a stuck busy bid.
  try{for(const stage of stages){const event=j.events.find(e=>e.stage===stage);event.status='running';await runStage(stage,b,j,refs,()=>{});event.status='complete';event.detail='Validated sample output; no AI request';save(stageLabels[stage]+' completed','Browser demo calculation');}j.status='complete';}
  catch(e){j.status='failed';j.error=e.message;const event=j.events.find(e=>e.status==='running');if(event)event.status='failed';b.status='Workflow failed';save('Workflow failed',e.message);}
  j.updated_at=now();b.busy=false;s.jobs[j.id]=j;s.bids[id]=b;persist(s);return {job_id:j.id};
 }else if(action==='scope'){
  const x=validate('scope',clone(body.scope));assertReferences('scope',x);
  if(x.clarifications.some(c=>c.resolved&&!c.answer?.trim()))throw Error('Resolved clarifications require an answer.');
  if(body.confirm===true&&x.clarifications.some(c=>c.severity==='high'&&!c.resolved))throw Error('Resolve high-severity clarifications before confirming scope.');
  clearDownstream(b);b.scope=x;b.confirmed=body.confirm===true;b.status=b.confirmed?'Choose workflow':'Scope review';save(b.confirmed?'Scope confirmed':'Scope edited','Downstream outputs invalidated; current scope saved.');
 }else if(action==='retrieve'){
  if(!b.confirmed)throw Error('Confirm scope first.');if(!['accelerator','expert'].includes(body.workflow))throw Error('Invalid workflow.');
  b.provenance={reference_id:referenceId,engine_version:engineVersion};b.active_job_id=null;b.workflow=body.workflow;b.baseline=null;b.results={};b.matches=rankProjects(b.scope,projects).slice(0,b.workflow==='accelerator'?3:5);b.status='Select reference';save('References ranked',`${b.workflow}; deterministic weighted score, not probability`);
 }else if(action==='baseline'){
  const p=b.matches.find(p=>p.id===body.project_id);if(!p)throw Error('Choose a retrieved reference.');b.baseline=p;b.results={priced_bom:priceBOM(p.bom,catalog),delta:baselineDelta(b.scope,p)};b.status='Review';save('Baseline selected',`${p.id} — ${p.name}; historical quantities retained, deltas require review`);
 }else if(action==='approve'){
  const {reviewer,notes,acknowledged}=body;
  if(!b.confirmed||b.status!=='Review')throw Error('Complete a workflow before approval.');
  if(!reviewer?.trim()||acknowledged!==true)throw Error('Enter a reviewer and acknowledge all review items.');
  if(b.scope.clarifications.some(c=>c.severity==='high'&&!c.resolved))throw Error('Resolve high-severity scope questions first.');
  if(b.workflow==='architect'&&(!b.results.services||b.results.bom.gaps.length||b.results.architecture.issues.length))throw Error('Resolve BOM gaps and architecture issues before approval.');
  const pending=b.scope.clarifications.filter(c=>!c.resolved).length+(b.results.services?.unresolved.length||0)+(b.results.delta?.filter(d=>d.delta!==0).length||0);
  if(pending&&!notes?.trim())throw Error('Record your disposition of open questions, excluded services and baseline deltas.');
  b.approval={reviewer:reviewer.trim(),notes:notes?.trim()||'',at:now(),mode:b.mode,type:b.workflow==='architect'?'Proposal baseline approval':'Reference baseline approval',conditional:pending>0};b.status='Approved';save('Human approval recorded',`${b.approval.reviewer}; ${b.approval.type}; demo`);
 }else throw Error('Unsupported demo operation.');
 persist(s);return clone(b);
}
export async function demoDownload(url){
 const s=load(),[,resource,id,action,revision]=url.split('/'),b=s.bids[id];
 if(resource!=='bids'||!b)throw Error('Bid not found.');
 if(action==='pdf'){
  if(!b.scope)throw Error('Generate project scope before exporting a PDF.');
  const {createProposalPDF,pdfFilename}=await import('./demoPdf.js');
  return {blob:await createProposalPDF(b),name:pdfFilename(b)};
 }
 let value=b,name=`Ataa-${id.slice(0,8)}.json`;
 if(action==='revisions'){value=s.revisions[id]?.find(r=>r.revision===Number(revision))?.snapshot;if(!value)throw Error('Revision not found.');name=`Ataa-${id.slice(0,8)}-revision-${revision}.json`;}
 else if(action==='export')value={...b,document:b.document?{name:b.document.name,sample:b.document.sample}:null,notice:'Browser demo export. Synthetic data; self-attested approval.'};
 else throw Error('Download not found.');
 return {blob:new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),name};
}
