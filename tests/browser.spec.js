import {test,expect,run} from './browser-harness.js';
async function prepare(page,name){
 await page.goto('/');
 await page.getByRole('button',{name:'New bid',exact:true}).click();
 await page.getByRole('textbox',{name:'Project name',exact:true}).fill(name);
 await page.getByRole('button',{name:'Create bid',exact:true}).click();
 await page.getByRole('button',{name:'Load sample RFQ',exact:true}).click();
 await page.getByRole('button',{name:'Analyse RFQ',exact:true}).click();
 await expect(page.getByText('One shared understanding of the RFQ',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Confirm & continue',exact:true}).click();
}
async function approve(page){
 await page.getByRole('button',{name:'Continue to review',exact:true}).click();
 await page.getByRole('textbox',{name:'Reviewer name',exact:true}).fill('Demo Reviewer');
 await page.getByRole('textbox',{name:'Decision notes / conditions',exact:true}).fill('Prototype baseline accepted; open clarifications and exclusions require follow-up before a customer offer.');
 await page.getByRole('checkbox').check();
 await page.getByRole('button',{name:'Approve baseline',exact:true}).click();
 await expect(page.getByText('APPROVED WITH CONDITIONS',{exact:true})).toBeVisible();
 const downloaded=page.waitForEvent('download');
 await page.getByRole('button',{name:'Download proposal PDF',exact:true}).click();
 const file=await downloaded;expect(file.suggestedFilename()).toMatch(/E2E .* - Ataa Proposal\.pdf$/);
 await file.saveAs('runtime/e2e/'+file.suggestedFilename());
 await page.reload();
 await expect(page.getByRole('heading',{name:'Your next winning bid starts here.'})).toBeVisible();
}
test('Architect runs all four agents, diagram, effort, approval and persistence',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await prepare(page,'E2E Architect');
 await page.getByRole('button',{name:'Run Architect',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your solution baseline is ready for review.'})).toBeVisible();
 await page.getByRole('button',{name:'Plant architecture',exact:true}).click();
 await expect(page.locator('.react-flow__node')).toHaveCount(11);
 await page.getByRole('button',{name:'Service hours',exact:true}).click();
 await expect(page.getByText('195.8 h',{exact:true}).first()).toBeVisible();
 await approve(page);expect(errors).toEqual([]);
});
test('Accelerator returns three projects and the correct baseline delta',async({page})=>{
 await prepare(page,'E2E Accelerator');await page.getByRole('button',{name:'Find similar projects',exact:true}).click();
 await expect(page.locator('.reference-card')).toHaveCount(3);
 await page.getByRole('button',{name:'Select reference',exact:true}).first().click();
 await page.getByRole('button',{name:'Use selected baseline',exact:true}).click();
 await expect(page.getByText('+2 each',{exact:true})).toBeVisible();await approve(page);
});
test('Expert Tool compares references and permits a lower-ranked choice',async({page})=>{
 await prepare(page,'E2E Expert');await page.getByRole('button',{name:'Browse matches',exact:true}).click();
 await expect(page.locator('.reference-card')).toHaveCount(5);
 await page.getByRole('checkbox',{name:'Add to comparison',exact:true}).nth(0).check();
 await page.getByRole('checkbox',{name:'Add to comparison',exact:true}).nth(2).check();
 await expect(page.getByRole('heading',{name:'Compare references',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Select reference',exact:true}).nth(2).click();
 await page.getByRole('button',{name:'Use selected baseline',exact:true}).click();await approve(page);
});
test('Mobile overview has no horizontal overflow; unavailable Live mode is explicit',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.getByRole('switch',{name:'Live AI mode'}).click();
 await expect(page.getByText(/Live AI needs an Azure endpoint/)).toBeVisible();
});

test('Storage overview and project data expose retained files, revisions and persistent runs',async({page})=>{
 await prepare(page,'E2E Data');
 await page.getByRole('button',{name:'Project data',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Project data',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Revision history',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Agent run history',exact:true})).toBeVisible();
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download file',exact:true}).first().click();
 expect((await download).suggestedFilename()).toBe('AlphaEnergy_SCADA_RFQ.txt');
 await page.getByRole('button',{name:'Data & storage',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your data, accounted for.',exact:true})).toBeVisible();
 await expect(page.getByText('SQLite database',{exact:true}).first()).toBeVisible();
});

await run();
