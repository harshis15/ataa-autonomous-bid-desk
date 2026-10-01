import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// One API process per local data directory. SQLite is not a distributed job queue.
export function acquireLock(directory) {
  fs.mkdirSync(directory, {recursive:true, mode:0o700});
  const file=path.join(directory,'server.lock');
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const fd=fs.openSync(file,'wx',0o600);
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);
      return ()=>{try {if(JSON.parse(fs.readFileSync(file)).pid===process.pid)fs.unlinkSync(file);}catch{}};
    } catch(error) {
      if(error.code!=='EEXIST')throw error;
      let owner;
      try {owner=JSON.parse(fs.readFileSync(file,'utf8')).pid;}catch{throw Error('Unreadable server.lock. Stop all Ataa processes, then remove the stale lock.');}
      if(!Number.isInteger(owner)||owner<1)throw Error('Invalid server.lock. Stop Ataa before removing it.');
      try {process.kill(owner,0);throw Error('This data directory is already in use. Stop the other Ataa server before starting or backing up.');}
      catch(e){if(e.code!=='ESRCH')throw e;fs.unlinkSync(file);}
    }
  }
  throw Error('Could not acquire the local storage lock.');
}

export class Repository {
  constructor(directory) {
    this.directory=path.resolve(directory);fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(this.directory,'ataa.sqlite'));
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version=this.db.prepare('PRAGMA user_version').get().user_version;
    if(version>1)throw Error('This database was created by a newer Ataa version.');
    if(version===0)this.transaction(()=>{
      this.db.exec(`
        CREATE TABLE bids(id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
        CREATE TABLE bid_revisions(bid_id TEXT NOT NULL REFERENCES bids(id), revision INTEGER NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(bid_id,revision));
        CREATE TABLE audit_events(bid_id TEXT NOT NULL REFERENCES bids(id), sequence INTEGER NOT NULL, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, PRIMARY KEY(bid_id,sequence));
        CREATE TABLE jobs(id TEXT PRIMARY KEY, bid_id TEXT NOT NULL REFERENCES bids(id), status TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
        CREATE INDEX jobs_by_bid ON jobs(bid_id,created_at);
        CREATE TABLE artifacts(id TEXT PRIMARY KEY, bid_id TEXT NOT NULL REFERENCES bids(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
        CREATE INDEX artifacts_by_bid ON artifacts(bid_id,revision,kind);
        CREATE TABLE reference_versions(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)));
        CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version=1;
      `);
    });
  }
  transaction(fn) {this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');this.db.close();}
  getBid(id){const row=this.db.prepare('SELECT body FROM bids WHERE id=?').get(id);return row?JSON.parse(row.body):null;}
  listBids(){return this.db.prepare('SELECT body FROM bids ORDER BY updated_at DESC').all().map(r=>JSON.parse(r.body));}
  // Bid state, revision, appended audit and job checkpoint commit in one transaction.
  saveBid(b,reason,{job,artifact}={}) {
    const next=structuredClone(b);
    this.transaction(()=>{
      const old=this.db.prepare('SELECT revision FROM bids WHERE id=?').get(b.id);
      if(old && old.revision!==(b.revision||0))throw Error('Project changed. Refresh before saving.');
      next.revision=(old?.revision||0)+1;
      if(next.approval&&!next.approval.revision)next.approval.revision=next.revision;
      this.db.prepare('INSERT INTO bids VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,revision=excluded.revision,updated_at=excluded.updated_at,body=excluded.body').run(next.id,next.name,next.status,next.revision,next.updated_at,JSON.stringify(next));
      this.db.prepare('INSERT INTO bid_revisions VALUES(?,?,?,?,?)').run(next.id,next.revision,next.updated_at,reason,JSON.stringify(next));
      const count=this.db.prepare('SELECT count(*) AS n FROM audit_events WHERE bid_id=?').get(b.id).n;
      for(let i=count;i<next.audit.length;i++){const a=next.audit[i];this.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(b.id,i+1,a.at,a.action,a.detail);}
      if(job)this.saveJob(job);
      if(artifact)this.addArtifact(artifact,next.revision);
    });
    Object.assign(b,next);return b;
  }
  saveJob(j){this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body').run(j.id,j.bid_id,j.status,j.created_at,JSON.stringify(j));}
  getJob(id){const r=this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id);return r?JSON.parse(r.body):null;}
  listJobs(bidId){return (bidId?this.db.prepare('SELECT body FROM jobs WHERE bid_id=? ORDER BY created_at DESC').all(bidId):this.db.prepare('SELECT body FROM jobs ORDER BY created_at DESC').all()).map(r=>JSON.parse(r.body));}
  revisions(id){return this.db.prepare('SELECT revision,created_at,reason FROM bid_revisions WHERE bid_id=? ORDER BY revision DESC').all(id);}
  revision(id,n){const r=this.db.prepare('SELECT body FROM bid_revisions WHERE bid_id=? AND revision=?').get(id,n);return r?JSON.parse(r.body):null;}
  addArtifact(a,revision=a.revision){this.db.prepare('INSERT INTO artifacts VALUES(?,?,?,?,?,?)').run(a.id,a.bid_id,revision,a.kind,a.created_at,JSON.stringify({...a,revision}));}
  artifacts(id){return this.db.prepare('SELECT body FROM artifacts WHERE bid_id=? ORDER BY created_at DESC').all(id).map(r=>JSON.parse(r.body));}
  artifact(id){const r=this.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id);return r?JSON.parse(r.body):null;}
  putReferences(id,body){this.db.prepare('INSERT OR IGNORE INTO reference_versions VALUES(?,?,?)').run(id,new Date().toISOString(),JSON.stringify(body));}
  getReferences(id){const r=this.db.prepare('SELECT body FROM reference_versions WHERE id=?').get(id);if(!r)throw Error('Reference version missing.');return JSON.parse(r.body);}
  stats(){const tables=['bids','bid_revisions','audit_events','jobs','artifacts','reference_versions'];return Object.fromEntries(tables.map(t=>[t,this.db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n]));}
  migrateLegacy(){
    if(this.db.prepare("SELECT 1 FROM settings WHERE key='legacy_import'").get())return;
    const file=path.join(this.directory,'bids.json');if(!fs.existsSync(file))return;
    const old=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!Array.isArray(old)||old.some(b=>!b.id||!b.name||!Array.isArray(b.audit)))throw Error('Legacy bids.json is invalid; original file was not changed.');
    // Entire import rolls back on any malformed record or duplicate; no partial import.
    this.transaction(()=>{
      for(const original of old){
        if(this.getBid(original.id))throw Error('Legacy bid ID already exists; import aborted.');
        const b=structuredClone(original);b.revision=1;b.busy=false;b.active_job_id=null;
        if(original.busy){b.status='Needs attention';b.audit.push({at:new Date().toISOString(),action:'Legacy run interrupted',detail:'No stage checkpoints exist for v2 runs. Start the workflow again.'});}
        const body=JSON.stringify(b);
        this.db.prepare('INSERT INTO bids VALUES(?,?,?,?,?,?)').run(b.id,b.name,b.status,1,b.updated_at,body);
        this.db.prepare('INSERT INTO bid_revisions VALUES(?,?,?,?,?)').run(b.id,1,b.updated_at,'Imported from v2',body);
        b.audit.forEach((a,i)=>this.db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?)').run(b.id,i+1,a.at,a.action,a.detail));
      }
      this.db.prepare('INSERT INTO settings VALUES(?,?)').run('legacy_import',new Date().toISOString());
    });
  }
}
