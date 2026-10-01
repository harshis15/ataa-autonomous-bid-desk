import React,{useEffect,useState} from 'react';
const date=s=>new Date(s).toLocaleString();
async function read(url){const r=await fetch('/api'+url);const x=await r.json();if(!r.ok)throw Error(x.error);return x;}
export default function DataStorage({bidId}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;read(bidId?`/bids/${bidId}/data`:'/storage').then(x=>active&&setData(x)).catch(e=>active&&setError(e.message));return()=>{active=false;};},[bidId]);
 if(error)return <div role="alert" className="error">{error}</div>;
 if(!data)return <section className="panel">Loading saved data…</section>;
 if(!bidId)return <>
  <div className="page-title"><div><div className="eyebrow">DATA & STORAGE</div><h1>Your data, accounted for.</h1><p>Project records and original files are saved on the machine running the Ataa server.</p></div></div>
  <section className="panel"><h2>What is stored?</h2><div className="table-wrap"><table><thead><tr><th>Data</th><th>Storage</th><th>Saved records</th></tr></thead><tbody>
   <tr><td>Projects and generated scope / solution JSON</td><td>SQLite database</td><td>{data.counts.bids} project{data.counts.bids===1?'':'s'}</td></tr>
   <tr><td>Project revision snapshots</td><td>SQLite database</td><td>{data.counts.bid_revisions}</td></tr>
   <tr><td>Audit events</td><td>SQLite database</td><td>{data.counts.audit_events}</td></tr>
   <tr><td>Agent runs and completed-stage checkpoints</td><td>SQLite database</td><td>{data.counts.jobs}</td></tr>
   <tr><td>Original RFQs and downloaded proposal PDFs</td><td>Local file store, linked to projects</td><td>{data.counts.artifacts} file record{data.counts.artifacts===1?'':'s'}</td></tr>
   <tr><td>Catalog, history, service rules and prompt versions</td><td>Versioned snapshots in SQLite</td><td>{data.counts.reference_versions}</td></tr>
  </tbody></table></div></section>
  <div className="review-grid"><section className="panel"><h3>Retention & backup</h3><p>{data.retention}</p><p>Replacing an RFQ or changing mode clears the active draft. Earlier revisions and files stay available in Project data.</p><p>Back up the database and file store together. A copy of the database alone does not include RFQ or PDF files.</p><p>See <code>docs/DATA_AND_STORAGE.md</code> for backup and restore commands.</p></section><section className="panel"><h3>Local storage and Azure AI</h3><p>Live AI sends extracted RFQ text and relevant solution data to the Azure deployment configured on the server. It does not move this workspace’s database into Azure.</p><p>{data.access}</p><p>The API key is read from the backend environment and is not included in project exports.</p></section></div>
 </>;
 return <>
  <section className="panel"><h2>Project data</h2><p>Current revision: <b>{data.revision}</b>. Files and previous revisions survive mode changes and RFQ replacements.</p>
   {data.document&&!data.document.artifact_id&&<div className="notice amber">This RFQ was imported from v2. Only its extracted text is available; the original file was not retained by that version.</div>}
   <h3>Saved files</h3>{data.artifacts.length?<div className="table-wrap"><table><thead><tr><th>File</th><th>Type / revision</th><th>Integrity</th><th/></tr></thead><tbody>{data.artifacts.map(a=><tr key={a.id}><td>{a.name}<small>{a.bytes.toLocaleString()} bytes · {date(a.created_at)}</small></td><td>{a.kind} · r{a.revision}</td><td><code title={a.sha256}>{a.sha256.slice(0,16)}…</code></td><td><a className="btn secondary" href={`/api/bids/${bidId}/artifacts/${a.id}`}>Download file</a></td></tr>)}</tbody></table></div>:<p>No original files saved yet.</p>}
  </section>
  <section className="panel"><h3>Revision history</h3><p>Each saved change has a read-only JSON snapshot, including extracted RFQ text. Downloads may contain customer information.</p><div className="table-wrap"><table><thead><tr><th>Revision</th><th>Change</th><th>Saved</th><th/></tr></thead><tbody>{data.revisions.map(r=><tr key={r.revision}><td>r{r.revision}</td><td>{r.reason}</td><td>{date(r.created_at)}</td><td><a href={`/api/bids/${bidId}/revisions/${r.revision}`}>Download JSON</a></td></tr>)}</tbody></table></div></section>
  <section className="panel"><h3>Agent run history</h3>{!data.jobs.length&&<p>No runs yet.</p>}{data.jobs.map(j=><details className="json" key={j.id}><summary>{j.stages.join(' → ')} · {j.status} · {date(j.created_at)}</summary><p>Reference version: <code>{j.reference_id.slice(0,16)}</code></p>{j.error&&<p>{j.error}</p>}<ul>{j.events.map(e=><li key={e.stage}>{e.label}: {e.status}{e.attempts?` · ${e.attempts} Azure attempt(s)`:''}</li>)}</ul></details>)}</section>
 </>;
}
