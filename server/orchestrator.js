import {randomUUID} from 'node:crypto';
import {stageLabels} from '../shared/schemas.js';
import {isLiveConfigured} from './azure.js';
import {runStage} from './workflows.js';

export class Orchestrator {
  constructor({repository,record,referenceId,engineVersion}){Object.assign(this,{repository,record,referenceId,engineVersion});}
  ready(b){if(b.mode==='live'&&!isLiveConfigured())throw Error('Live AI is not configured. Set endpoint, deployment, API key and ENABLE_LIVE_AI=true in .env, then restart.');}
  start(b,stages){
    this.ready(b);
    const j={id:randomUUID(),bid_id:b.id,status:'running',mode:b.mode,created_at:new Date().toISOString(),reference_id:this.referenceId,engine_version:this.engineVersion,
      deployment:b.mode==='live'?process.env.AZURE_OPENAI_DEPLOYMENT:null,endpoint:b.mode==='live'?process.env.AZURE_OPENAI_ENDPOINT:null,
      max_completion_tokens:b.mode==='live'?(Number(process.env.AZURE_MAX_COMPLETION_TOKENS)||12000):null,
      stages,events:stages.map(stage=>({stage,label:stageLabels[stage],status:'waiting',detail:'',attempts:0})),error:null};
    b.active_job_id=j.id;b.busy=true;b.recovery_pending=false;
    b.provenance={reference_id:j.reference_id,engine_version:j.engine_version};
    this.record(b,'Run started',`${b.mode}: ${stages.join(' → ')}`,{job:j});
    void this.execute(b,j);return j;
  }
  recover(){
    // Never automatically repeat an Azure request after a crash: the provider may have billed it.
    for(const j of this.repository.listJobs().filter(j=>j.status==='running')){
      const b=this.repository.getBid(j.bid_id);j.status='interrupted';j.error='Server stopped before the run finished. Completed stages are saved.';
      for(const e of j.events)if(e.status==='running'){e.status='interrupted';e.detail='No completed checkpoint; resuming repeats this stage.';}
      b.busy=false;b.recovery_pending=true;b.status='Run interrupted';
      this.record(b,'Run interrupted',j.error,{job:j});
    }
  }
  resume(b,acknowledged){
    const j=this.repository.getJob(b.active_job_id);
    if(!j||j.status!=='interrupted'||!b.recovery_pending)throw Error('There is no interrupted run to resume.');
    if(j.engine_version!==this.engineVersion)throw Error('Workflow code changed. Discard the interrupted run, then start a new workflow.');
    this.ready(b);
    if(b.mode==='live'){
      if(acknowledged!==true)throw Error('Acknowledge that an interrupted Azure request may be repeated and billed again.');
      if(j.deployment!==process.env.AZURE_OPENAI_DEPLOYMENT||j.endpoint!==process.env.AZURE_OPENAI_ENDPOINT||j.max_completion_tokens!==(Number(process.env.AZURE_MAX_COMPLETION_TOKENS)||12000))throw Error('Azure configuration changed. Restore it or discard this run and start again.');
    }
    j.status='running';j.error=null;b.busy=true;b.recovery_pending=false;
    this.record(b,'Run resumed','Continuing after the last committed stage.',{job:j});void this.execute(b,j);return j;
  }
  discard(b){
    const j=this.repository.getJob(b.active_job_id);
    if(!j||j.status!=='interrupted')throw Error('There is no interrupted run to discard.');
    j.status='cancelled';b.busy=false;b.recovery_pending=false;b.active_job_id=null;
    // Partial solutions remain in revisions, not the current editable bid.
    b.results={};b.baseline=null;b.matches=[];b.workflow=null;
    b.status=b.confirmed?'Choose workflow':b.scope?'Scope review':'Ready to analyse';
    this.record(b,'Run discarded','Partial results preserved in revision history; start a fresh workflow.',{job:j});
  }
  async execute(b,j){
    try {
      const refs=this.repository.getReferences(j.reference_id);
      for(const stage of j.stages){
        const event=j.events.find(e=>e.stage===stage);if(event.status==='complete')continue;
        event.status='running';event.started_at=new Date().toISOString();event.detail=b.mode==='demo'?'Loading labelled sample response':'Calling Azure AI';this.repository.saveJob(j);
        // Results become visible only when validation, audit and checkpoint all commit.
        const draft=structuredClone(b);await runStage(stage,draft,j,refs,x=>this.repository.saveJob(x));
        event.status='complete';event.finished_at=new Date().toISOString();event.detail='Schema and references checked';
        const last=j.stages.every(s=>j.events.find(e=>e.stage===s).status==='complete');
        if(last){j.status='complete';j.completed_at=event.finished_at;draft.busy=false;}
        this.record(draft,stageLabels[stage]+' completed',b.mode==='demo'?'Sample output':'Azure output validated',{job:j});b=draft;
      }
    }catch(e){
      // Reload committed state; failed or uncommitted outputs must not leak into a bid.
      b=this.repository.getBid(j.bid_id);j=this.repository.getJob(j.id);j.status='failed';j.error=e.name==='TimeoutError'?'Azure request timed out.':e.message;
      const current=j.events.find(e=>['running','interrupted'].includes(e.status));if(current){current.status='failed';current.detail=j.error;}
      b.busy=false;b.recovery_pending=false;b.status='Needs attention';
      try{this.record(b,'Run failed',j.error,{job:j});}catch(storageError){console.error('Workflow persistence failed:',storageError.message);process.exit(1);}
    }
  }
}
