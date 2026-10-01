import 'dotenv/config';
import {createProposalPDF,pdfFilename} from './pdf.js';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Repository,acquireLock} from './storage/database.js';
import {LocalFileStore,sha256} from './storage/files.js';
import {Orchestrator} from './orchestrator.js';
import {validate} from './workflows.js';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import {schemas,stageLabels} from '../shared/schemas.js';
import {rankProjects,baselineDelta,priceBOM,requiredRuleIds,calculateServices,assertReferences} from '../shared/engine.js';
import {isLiveConfigured} from './azure.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const catalog=data('ProductCatalog.json'),projects=data('HistoricalProjects.json'),rules=data('ServiceRules.json').rules;
const runtime=path.resolve(process.env.ATAA_DATA_DIR||path.join(root,'runtime'));
const releaseLock=acquireLock(runtime);process.on('exit',releaseLock);
const repository=new Repository(runtime);repository.migrateLegacy();
const fileStore=new LocalFileStore(path.join(runtime,'objects'));
const promptFiles={scope:'01_Scope_Agent_Prompt.txt',bom:'02_BOM_Agent_Prompt.txt',architecture:'03_Plant_Architecture_Agent_Prompt.txt',services:'04_Service_Estimation_Agent_Prompt.txt'};
const references={catalog,projects,rules,schemas,fixtures:{scope:data('SampleScope.json'),bom:data('SampleBOM.json'),architecture:data('SampleArchitecture.json')},prompts:Object.fromEntries(Object.entries(promptFiles).map(([k,v])=>[k,fs.readFileSync(path.join(root,'prompts',v),'utf8')]))};
const referenceId=sha256(JSON.stringify(references));repository.putReferences(referenceId,references);
const engineVersion=sha256(['server/index.js','server/orchestrator.js','server/workflows.js','server/azure.js','shared/engine.js','shared/schemas.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n'));
function audit(b,action,detail,options={}){b.updated_at=new Date().toISOString();b.audit.push({at:b.updated_at,action,detail});repository.saveBid(b,action,options);}
function clearDownstream(b){b.confirmed=false;b.workflow=null;b.results={};b.baseline=null;b.matches=[];b.approval=null;b.status='Scope review';b.active_job_id=null;b.recovery_pending=false;}
const orchestrator=new Orchestrator({repository,record:audit,referenceId,engineVersion});orchestrator.recover();
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'2mb'}));
// Same-origin write requests only; no permissive CORS for the local secret-bearing backend.
app.use('/api',(req,res,next)=>{const origin=req.get('origin');if(origin){try{const host=new URL(origin).hostname;if(host!==req.hostname)return res.status(403).json({error:'Cross-origin requests are not permitted.'});}catch{return res.status(403).json({error:'Invalid origin.'});}}next();});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}});
app.get('/api/health',(req,res)=>res.json({ok:true,live_configured:isLiveConfigured(),demo_available:true,storage:"sqlite",schema_version:1}));
app.get('/api/bootstrap',(req,res)=>res.json({catalog,projects:projects.map(({bom,...p})=>p),rules,live_configured:isLiveConfigured()}));
app.get('/api/bids',(req,res)=>res.json(repository.listBids()));
app.post('/api/bids',(req,res)=>{const {name,customer,mode='demo'}=req.body;if(!['demo','live'].includes(mode)||!name?.trim()||!customer?.trim())return res.status(400).json({error:'Project name, customer and valid mode are required.'});if(name.length>200||customer.length>200)return res.status(400).json({error:'Project fields must be under 200 characters.'});const b={id:randomUUID(),name:name.trim(),customer:customer.trim(),mode,status:'Draft',created_at:new Date().toISOString(),updated_at:new Date().toISOString(),document:null,scope:null,confirmed:false,workflow:null,results:{},baseline:null,matches:[],approval:null,audit:[],busy:false};audit(b,'Bid created',`Mode: ${mode}`);res.status(201).json(b);});
app.param('id',(req,res,next,id)=>{const b=repository.getBid(id);if(!b)return res.status(404).json({error:'Bid not found.'});req.bid=b;next();});
app.get('/api/bids/:id',(req,res)=>res.json(req.bid));
function editable(req,res,next){if(req.bid.busy)return res.status(409).json({error:'A workflow is running. Wait for it to finish.'});if(req.bid.recovery_pending)return res.status(409).json({error:'Resume or discard the interrupted run before editing.'});if(req.bid.approval)return res.status(409).json({error:'Approved snapshot is locked. Create a new bid to revise.'});next();}
app.patch('/api/bids/:id/mode',editable,(req,res)=>{const b=req.bid;if(!['live','demo'].includes(req.body.mode))return res.status(400).json({error:'Invalid mode.'});b.mode=req.body.mode;b.scope=null;b.document=null;clearDownstream(b);b.status='Draft';audit(b,'Mode changed',`${b.mode}; previous generated outputs cleared to preserve provenance.`);res.json(b);});
app.post('/api/bids/:id/sample',editable,(req,res)=>{const b=req.bid;b.document={name:'AlphaEnergy_SCADA_RFQ.txt',text:fs.readFileSync(path.join(root,'public/samples/AlphaEnergy_SCADA_RFQ.txt'),'utf8'),sample:true};const artifact=fileStore.put(Buffer.from(b.document.text),{bid_id:b.id,name:b.document.name,kind:'source',mime:'text/plain'});b.document.artifact_id=artifact.id;b.scope=null;clearDownstream(b);b.status='Ready to analyse';audit(b,'Sample loaded','Synthetic Alpha Energy RFQ',{artifact});res.json(b);});
app.post('/api/bids/:id/document',editable,upload.single('file'),async(req,res)=>{
 try{const b=req.bid;if(b.mode==='demo')throw Error('Demo mode uses the bundled sample RFQ. Switch to Live AI to analyse your own document.');const f=req.file;if(!f)throw Error('Choose a file.');const ext=path.extname(f.originalname).toLowerCase();let text;
 if(ext==='.pdf')text=(await pdf(f.buffer)).text;else if(ext==='.docx')text=(await mammoth.extractRawText({buffer:f.buffer})).value;else if(['.txt','.md'].includes(ext))text=f.buffer.toString('utf8');else throw Error('Supported formats: PDF, DOCX, TXT and MD.');
 if(text.trim().length<40)throw Error('Not enough readable text. Scanned PDFs need OCR before uploading.');if(text.length>70000)throw Error('RFQ exceeds 70,000 characters. Upload a shorter extract.');
 const mime={'.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.txt':'text/plain','.md':'text/markdown'}[ext];const artifact=fileStore.put(f.buffer,{bid_id:b.id,name:f.originalname,kind:'source',mime});b.document={name:artifact.name,text,sample:false,artifact_id:artifact.id};b.scope=null;clearDownstream(b);b.status='Ready to analyse';audit(b,'RFQ uploaded',`${b.document.name}, ${text.length} extracted characters`,{artifact});res.json(b);
 }catch(e){res.status(400).json({error:e.message});}
});
app.get('/api/jobs/:job',(req,res)=>{const j=repository.getJob(req.params.job);if(!j)return res.status(404).json({error:'Run not found.'});res.json(j);});
app.post('/api/bids/:id/analyse',editable,(req,res)=>{const b=req.bid;if(!b.document)return res.status(400).json({error:'Load or upload an RFQ first.'});orchestrator.ready(b);clearDownstream(b);b.scope=null;const job=orchestrator.start(b,['scope']);res.status(202).json({job_id:job.id});});
app.patch('/api/bids/:id/scope',editable,(req,res)=>{try{const b=req.bid;const scope=validate('scope',req.body.scope);assertReferences('scope',scope);
 if(scope.clarifications.some(c=>c.resolved&&!c.answer?.trim()))throw Error('Resolved clarifications require an answer.');
 const confirm=req.body.confirm===true;if(confirm&&scope.clarifications.some(c=>c.severity==='high'&&!c.resolved))throw Error('Resolve high-severity clarifications before confirming scope.');
 clearDownstream(b);b.scope=scope;b.confirmed=confirm;b.status=confirm?'Choose workflow':'Scope review';audit(b,confirm?'Scope confirmed':'Scope edited','Downstream outputs invalidated; current scope saved.');res.json(b);
 }catch(e){res.status(400).json({error:e.message});}});
app.post('/api/bids/:id/architect',editable,(req,res)=>{const b=req.bid;if(!b.confirmed)return res.status(400).json({error:'Confirm scope first.'});orchestrator.ready(b);b.workflow='architect';b.results={};b.baseline=null;b.matches=[];const job=orchestrator.start(b,['bom','architecture','services']);res.status(202).json({job_id:job.id});});
app.post('/api/bids/:id/resume',(req,res)=>{if(req.bid.busy||req.bid.approval)return res.status(409).json({error:'Bid is running or approved.'});const job=orchestrator.resume(req.bid,req.body?.acknowledged);res.status(202).json({job_id:job.id});});
app.post('/api/bids/:id/discard-run',(req,res)=>{if(req.bid.busy||req.bid.approval)return res.status(409).json({error:'Bid is running or approved.'});orchestrator.discard(req.bid);res.json(req.bid);});
app.post('/api/bids/:id/retrieve',editable,(req,res)=>{const b=req.bid;if(!b.confirmed)return res.status(400).json({error:'Confirm scope first.'});if(!['accelerator','expert'].includes(req.body.workflow))return res.status(400).json({error:'Invalid workflow.'});b.provenance={reference_id:referenceId,engine_version:engineVersion};b.active_job_id=null;b.workflow=req.body.workflow;b.baseline=null;b.results={};b.matches=rankProjects(b.scope,projects).slice(0,b.workflow==='accelerator'?3:5);b.status='Select reference';audit(b,'References ranked',`${b.workflow}; deterministic weighted score, not probability`);res.json(b);});
app.post('/api/bids/:id/baseline',editable,(req,res)=>{const b=req.bid;const p=b.matches.find(p=>p.id===req.body.project_id);if(!p)return res.status(400).json({error:'Choose a retrieved reference.'});if(!b.provenance)b.provenance={reference_id:referenceId,engine_version:engineVersion,legacy_baseline:true};b.baseline=p;b.results={priced_bom:priceBOM(p.bom,repository.getReferences(b.provenance.reference_id).catalog),delta:baselineDelta(b.scope,p)};b.status='Review';audit(b,'Baseline selected',`${p.id} — ${p.name}; historical quantities retained, deltas require review`);res.json(b);});
app.post('/api/bids/:id/approve',editable,(req,res)=>{const b=req.bid;const {reviewer,notes,acknowledged}=req.body;if(!b.confirmed||b.status!=='Review')return res.status(400).json({error:'Complete a workflow before approval.'});if(!reviewer?.trim()||acknowledged!==true)return res.status(400).json({error:'Enter a reviewer and acknowledge all review items.'});if(b.scope.clarifications.some(c=>c.severity==='high'&&!c.resolved))return res.status(400).json({error:'Resolve high-severity scope questions first.'});if(b.workflow==='architect'&&(!b.results.services||b.results.bom.gaps.length||b.results.architecture.issues.length))return res.status(400).json({error:'Resolve BOM gaps and architecture issues before approval.'});const pending=b.scope.clarifications.filter(c=>!c.resolved).length+(b.results.services?.unresolved.length||0)+(b.results.delta?.filter(d=>d.delta!==0).length||0);if(pending&&!notes?.trim())return res.status(400).json({error:'Record your disposition of open questions, excluded services and baseline deltas.'});b.approval={reviewer:reviewer.trim(),notes:notes?.trim()||'',at:new Date().toISOString(),mode:b.mode,type:b.workflow==='architect'?'Proposal baseline approval':'Reference baseline approval',conditional:pending>0};b.status='Approved';audit(b,'Human approval recorded',`${b.approval.reviewer}; ${b.approval.type}; ${b.mode}`);res.json(b);});
function sendArtifact(res,a){const bytes=fileStore.read(a);res.setHeader('Content-Type',a.mime);res.setHeader('Content-Disposition',`attachment; filename="${a.name.replace(/[^\x20-\x7e]|["\\]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(a.name)}`);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.send(bytes);}
app.get('/api/bids/:id/pdf',async(req,res,next)=>{try{
 const b=req.bid;if(!b.scope)return res.status(400).json({error:'Generate project scope before exporting a PDF.'});
 if(b.busy||b.recovery_pending)return res.status(409).json({error:'Finish or discard the running workflow before exporting a PDF.'});
 let artifact=repository.artifacts(b.id).find(a=>a.kind==='report'&&a.revision===b.revision);
 if(!artifact){const bytes=await createProposalPDF(b);artifact=fileStore.put(bytes,{bid_id:b.id,name:pdfFilename(b),kind:'report',mime:'application/pdf'});artifact.revision=b.revision;repository.addArtifact(artifact);}
 sendArtifact(res,artifact);
 }catch(e){next(e);}});
app.get('/api/bids/:id/data',(req,res)=>res.json({revision:req.bid.revision,document:req.bid.document?{name:req.bid.document.name,artifact_id:req.bid.document.artifact_id||null}:null,revisions:repository.revisions(req.bid.id),artifacts:repository.artifacts(req.bid.id).map(({key,...a})=>a),jobs:repository.listJobs(req.bid.id)}));
app.get('/api/bids/:id/revisions/:revision',(req,res)=>{const n=Number(req.params.revision);if(!Number.isSafeInteger(n)||n<1)return res.status(400).json({error:'Invalid revision.'});const b=repository.revision(req.bid.id,n);if(!b)return res.status(404).json({error:'Revision not found.'});res.setHeader('Content-Disposition',`attachment; filename="Ataa-${b.id.slice(0,8)}-revision-${n}.json"`);res.json(b);});
app.get('/api/bids/:id/artifacts/:artifact',(req,res)=>{const a=repository.artifact(req.params.artifact);if(!a||a.bid_id!==req.bid.id)return res.status(404).json({error:'File not found for this project.'});sendArtifact(res,a);});
app.get('/api/storage',(req,res)=>res.json({provider:'SQLite + local file store',schema_version:1,database:'ATAA_DATA_DIR/ataa.sqlite',files:'ATAA_DATA_DIR/objects',counts:repository.stats(),reference_version:referenceId,retention:'Retained until the workspace is removed. No automatic deletion.',backup:'Stop the app, then run npm run data:backup -- /absolute/path/to/new-backup',access:'Local single-user workspace. No authentication or tenant isolation.'}));
app.get('/api/bids/:id/export',(req,res)=>{res.setHeader('Content-Disposition',`attachment; filename="Ataa-${req.bid.id.slice(0,8)}.json"`);res.json({...req.bid,document:req.bid.document?{name:req.bid.document.name,sample:req.bid.document.sample}:null,notice:'Prototype export. Synthetic catalog, prices and rules. Approval is self-attested and not an authenticated signature.'});});
app.use(express.static(path.join(root,'dist')));
app.use('/samples',express.static(path.join(root,'public/samples')));
app.use((err,req,res,next)=>res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'Maximum upload size is 5 MB.':err.message||'Request failed.'}));
app.get('/{*path}',(req,res)=>{if(req.path.startsWith('/api/'))return res.status(404).json({error:'Unknown API route.'});const index=path.join(root,'dist/index.html');if(fs.existsSync(index))res.sendFile(index);else res.status(200).send('Ataa API is running. Open http://localhost:5173 during npm run dev, or run npm run build before npm start.');});
const port=Number(process.env.PORT)||3001;const server=app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Ataa listening on http://${process.env.HOST||'127.0.0.1'}:${port}`));

for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();repository.close();releaseLock();process.exit(0);});
