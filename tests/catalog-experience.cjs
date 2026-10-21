const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(os.tmpdir(), 'purchase-calculator-catalog-v69');
const products = [
  ['CENTER001','青柠徽章','品牌甲','58mm',19.9,10,''],
  ['CENTER002','青柠保温杯','品牌甲','300ml',49,3,''],
  ['CENTER003','云朵钥匙扣','品牌乙','小号',29,8,''],
  ['CENTER004','云朵贴纸','品牌乙','一套',12.8,20,''],
  ['CENTER005','山间抱枕','品牌丙','小号',39,4,''],
  ['CENTER006','山间徽章','品牌丙','58mm',15,10,''],
  ...Array.from({ length: 24 }, (_,index)=>[`EXTRA${index}`,`扩展贴纸${index+1}`,'品牌丙','一套',8+index,20,''])
];
const fixture = [['商品编号','商品名称','品牌','规格/尺寸','单价','库存','图片'],...products].map(row=>row.join(',')).join('\n');

async function waitCards(page,count) {
  await page.waitForFunction(expected=>document.querySelectorAll('#cards .card').length === expected,count);
}
async function batch(page,button) {
  await page.locator('#batchMenuSummary').click();
  await page.locator(button).click();
  await page.locator('#batchModal.open').waitFor();
}
async function scrollCatalog(page,width) {
  if (width > 1100) await page.locator('.main').evaluate(el=>{el.scrollTop=650;});
  else await page.evaluate(()=>window.scrollTo(0,window.scrollY+document.querySelector('#cards').getBoundingClientRect().top+500));
  await page.waitForFunction(compact=>{
    const header=document.querySelector('#catalogHeader').getBoundingClientRect();
    const main=document.querySelector('.main').getBoundingClientRect();
    return compact ? Math.abs(header.top)<=2 : Math.abs(header.top-main.top)<=2;
  },width<=1100);
}
async function bounds(page) {
  const overflow=await page.locator('#catalogHeader').evaluate(header=>{
    const r=header.getBoundingClientRect();
    return [...header.querySelectorAll('input,button,summary')]
      .filter(el=>el.getClientRects().length && el.getBoundingClientRect().width)
      .filter(el=>{const box=el.getBoundingClientRect();return box.left<r.left-1 || box.right>r.right+1;})
      .map(el=>el.id||el.textContent);
  });
  assert.deepEqual(overflow,[],'Catalog controls fit their container');
}
async function run() {
  const html=await fs.readFile(path.join(root,'index.html'),'utf8');
  const version=html.match(/<meta name="app-version" content="([^"]+)"/)[1];
  await fs.mkdir(output,{ recursive:true });
  const browser=await chromium.launch({ channel:'msedge',headless:true });
  try {
    for (const width of [1600,1500,1250,390].filter(value=>!process.env.CATALOG_TEST_WIDTH || value===Number(process.env.CATALOG_TEST_WIDTH))) {
      const context=await browser.newContext({ viewport:{ width,height:900 } });
      await context.addInitScript(({version,width})=>{
        localStorage.setItem('timins_picker_tour_seen_v1','1');
        localStorage.setItem(`timins_picker_whats_new_${version}`,'1');
        if(width===1500) localStorage.setItem('timins_picker_columns_v1',JSON.stringify({left:500,right:500}));
      },{version,width});
      const page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      try {
        await page.goto(pathToFileURL(path.join(root,'index.html')).href);
        await page.locator('#fileInput').setInputFiles({ name:'catalog-test.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeff'+fixture) });
        await page.locator('#importCheckModal.open').waitFor();
        await page.locator('#confirmImportCheckBtn').click();
        await waitCards(page,30);
        const headerHeight=await page.locator('#catalogHeader').evaluate(el=>el.getBoundingClientRect().height);
        assert.ok(headerHeight < (width>760 ? 180 : 230),'Compact header leaves room for products');
        await bounds(page);

        const firstCard=page.locator('#cards .card').filter({ hasText:'青柠徽章' });
        await firstCard.locator('.qty-plus').click();
        assert.equal(await page.locator('#addFeedbackMessage').textContent(),'已加购 · 现有 1 件');
        await page.locator('#budgetInput').fill('160');
        await page.locator('#undoAddFeedbackBtn').click();
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥0');
        assert.equal(await page.locator('#budgetShow').textContent(),'¥160');
        await firstCard.locator('.qty-plus').click();
        await firstCard.locator('.qty-plus').click();
        assert.equal(await page.locator('#addFeedbackMessage').textContent(),'已加购 · 现有 2 件');
        await page.screenshot({path:path.join(output,`feedback-${width}.png`)});
        await page.locator('#undoAddFeedbackBtn').click();
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥19.90');
        await firstCard.locator('.qty-plus').click();
        await page.locator('#cards .card').filter({hasText:'云朵钥匙扣'}).locator('.candidate-toggle').click();
        assert.equal(await page.locator('#addFeedback').isVisible(),false);
        // Keep one existing item with a non-default quantity for bulk preview.
        await page.locator('#searchInput').fill('青柠 -杯');
        await waitCards(page,1);
        await page.locator('#brandFilterSection > summary').click();
        await page.locator('#brandFilters').getByRole('checkbox',{name:'品牌甲',exact:true}).check();
        await page.locator('#typeFilterSection > summary').click();
        await page.locator('#typeFilters').getByRole('checkbox',{name:'徽章/胸针',exact:true}).check();
        assert.equal(await page.locator('.filter-tag[data-filter-kind="search"]').count(),2);
        assert.equal(await page.locator('.filter-tag[data-filter-kind="brand"]').count(),1);
        assert.equal(await page.locator('.filter-tag[data-filter-kind="type"]').count(),1);
        await page.locator('#priceFilterSection > summary').click();
        await page.locator('#priceBinGrid button').first().click();
        await waitCards(page,0);
        await page.locator('.filter-tag[data-filter-kind="price"]').click();
        await waitCards(page,1);
        await page.locator('#sortSelect').selectOption('priceAsc');
        await page.locator('#viewModeSelect').selectOption('onlyAffordable');
        await page.locator('#searchInput').scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,`filters-${width}.png`)});
        await page.locator('.filter-tag[data-filter-kind="brand"]').click();
        assert.equal(await page.locator('#brandFilters input:checked').count(),0);
        await page.locator('.filter-tag[data-filter-kind="search"][data-filter-value="0"]').click();
        await waitCards(page,2);
        assert.equal(await page.locator('#searchInput').inputValue(),'-杯');
        await page.locator('#clearActiveFiltersBtn').click();
        await waitCards(page,30);
        assert.equal(await page.locator('#activeFilters').isVisible(),false);
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥39.80');
        assert.equal(await page.locator('#budgetShow').textContent(),'¥160');
        assert.equal(await page.locator('#candidateKinds').textContent(),'1');

        await batch(page,'#selectVisibleBtn');
        assert.match(await page.locator('#batchScope').textContent(),/全部筛选结果 · 30 款/);
        assert.match(await page.locator('#batchMetrics').textContent(),/新增款数29 款/);
        assert.equal(await page.locator('#batchPreview tbody tr').count(),12);
        assert.match(await page.locator('#batchNote').textContent(),/全部 30 款/);
        await page.screenshot({path:path.join(output,`batch-${width}.png`)});
        await page.locator('#cancelBatchBtn').click();
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥39.80');
        await page.locator('#searchInput').fill('青柠');
        await waitCards(page,2);
        await batch(page,'#selectVisibleBtn');
        assert.match(await page.locator('#batchMetrics').textContent(),/操作后合计¥88.80/);
        assert.match(await page.locator('#batchMetrics').textContent(),/新增款数1 款/);
        await page.locator('#confirmBatchBtn').click();
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥88.80');
        await page.waitForFunction(()=>document.querySelectorAll('#cards .card').length===2);
        assert.equal(await firstCard.locator('.qty-input').inputValue(),'2');
        if(width<=1380) await page.locator('#openCartDrawerBtn').click();
        await page.locator(width>1380 ? '#cartUndoBtn' : '#cartDrawerUndoBtn').click();
        if(width<=1380) await page.locator('#closeCartDrawerBtn').click();
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥39.80');
        await batch(page,'#selectVisibleBtn');
        await page.locator('#confirmBatchBtn').click();
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥88.80');
        await batch(page,'#candidateVisibleBtn');
        await page.locator('#confirmBatchBtn').click();
        assert.equal(await page.locator('#candidateKinds').textContent(),'3');
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥88.80');
        await page.locator('#searchInput').fill('山间');
        await waitCards(page,2);
        await batch(page,'#clearSelectionTopBtn');
        assert.match(await page.locator('#batchScope').textContent(),/整个购物车 · 2 款 · 3 件/);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥88.80');
        await batch(page,'#clearSelectionTopBtn');
        await page.locator('#confirmBatchBtn').click();
        assert.equal(await page.locator('#selectedTotal').textContent(),'¥0');
        assert.equal(await page.locator('#candidateKinds').textContent(),'3');
        await page.locator('#clearActiveFiltersBtn').click();
        await waitCards(page,30);
        await page.locator('#batchMenuSummary').click();
        await page.locator('#searchInput').click();
        assert.equal(await page.locator('#batchMenu').getAttribute('open'),null);

        await page.locator('#budgetInput').fill('20');
        await page.locator('#viewModeSelect').selectOption('onlyAffordable');
        const affordableCount=products.filter(row=>row[4]<=20).length;
        await waitCards(page,affordableCount);
        await batch(page,'#selectVisibleBtn');
        await page.locator('#confirmBatchBtn').click();
        await waitCards(page,0);
        await batch(page,'#clearSelectionTopBtn');
        await page.locator('#confirmBatchBtn').click();
        await waitCards(page,affordableCount);
        await page.locator('#budgetInput').fill('160');
        await page.locator('#clearActiveFiltersBtn').click();
        await waitCards(page,30);

        await page.locator('#appearanceSettings > summary').click();
        for (const theme of ['cream','light','dark']) {
          await page.locator('#themeSelect').selectOption(theme);
          await scrollCatalog(page,width);
          await bounds(page);
          await page.waitForTimeout(250);
          await page.screenshot({path:path.join(output,`catalog-${width}-${theme}.png`)});
        }
        assert.deepEqual(errors,[],'No page script errors');
        console.log(`PASS ${width}px: sticky header, filter removal, scoped undo, bulk scope/counts/totals/cancel, themes, bounds`);
      } catch (error) {
        await page.screenshot({path:path.join(output,`failure-${width}.png`)});
        console.error(await page.evaluate(()=>({
          scrollY:window.scrollY,
          header:document.querySelector('#catalogHeader').getBoundingClientRect().toJSON(),
          ancestors:['html','body','.app','.main'].map(selector=>{
            const el=document.querySelector(selector);const s=getComputedStyle(el);
            return {selector,overflow:s.overflow,scrollTop:el.scrollTop,height:el.clientHeight,scrollHeight:el.scrollHeight};
          })
        })));
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  console.log(`Screenshots: ${output}`);
}
run().catch(error=>{console.error(error);process.exitCode=1;});
