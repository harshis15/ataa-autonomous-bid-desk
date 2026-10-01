import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import {createProposalPDF,pdfFilename} from '../server/pdf.js';
import {priceBOM,calculateServices,requiredRuleIds} from '../shared/engine.js';
const data=n=>JSON.parse(fs.readFileSync(new URL('../data/'+n,import.meta.url)));
test('PDF contains the generated solution, approval and audit with safe project filename',async()=>{
 const scope=data('SampleScope.json'),bom=data('SampleBOM.json'),catalog=data('ProductCatalog.json'),rules=data('ServiceRules.json').rules;
 const b={id:'test-bid',name:'SCADA / Modernization',mode:'demo',workflow:'architect',status:'Approved',scope,results:{bom,priced_bom:priceBOM(bom,catalog),architecture:data('SampleArchitecture.json'),services:calculateServices({rule_ids:requiredRuleIds(scope,rules),notes:[]},scope,bom,catalog,rules)},approval:{type:'Proposal baseline approval',reviewer:'Test Reviewer',at:'2026-09-27',notes:'Support excluded',conditional:true},audit:[{at:'2026-09-27',action:'Human approval recorded',detail:'Test Reviewer'}]};
 const bytes=await createProposalPDF(b);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const parsed=await pdf(bytes);
 for(const marker of ['Bill of materials','Plant architecture','Service hours','Human approval','Audit trail','SRV-RM-001','195.8','Test Reviewer'])assert.ok(parsed.text.includes(marker),marker);
 assert.equal(pdfFilename(b),'SCADA - Modernization - Ataa Proposal.pdf');
});
