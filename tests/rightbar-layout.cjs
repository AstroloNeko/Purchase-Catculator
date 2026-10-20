const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const screenshots = path.join(os.tmpdir(), 'purchase-calculator-rightbar-v68');
const longName = '用于检查窄栏商品名称和数量操作排列的超长商品名称保温杯';
const longBrand = '用于检查品牌分组小计的超长品牌名称';
const fixture = [
  '商品编号,商品名称,品牌,规格/尺寸,单价,库存,图片',
  'RIGHT001,测试徽章,测试品牌,58mm,19.9,10,',
  `RIGHT002,${longName},${longBrand},300ml,49,5,`,
  'RIGHT003,测试钥匙扣,测试品牌,小号,29,8,',
  'RIGHT004,测试贴纸,另一个品牌,一套,12.8,20,',
  'RIGHT005,测试抱枕,另一个品牌,小号,39,3,'
].join('\n');

async function checkBounds(container) {
  const problems = await container.evaluate(root => {
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll('button,input,summary,.side-details,.side-actions,.rec-item,.compare-item')]
      .filter(el => el.getClientRects().length && el.getBoundingClientRect().width)
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
      })
      .map(el => el.id || el.className);
  });
  assert.deepEqual(problems, [], 'Controls and item content stay inside the rail/drawer');
}

async function run() {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const version = html.match(/<meta name="app-version" content="([^"]+)"/)[1];
  await fs.mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const scenario of [
      { width: 1600, rail: 320 },
      { width: 1600, rail: 260 },
      { width: 1920, rail: 460 },
      { width: 1250, rail: 320 },
      { width: 390, rail: 320 }
    ]) {
      const desktop = scenario.width > 1380;
      const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 } });
      await context.addInitScript(({ version, rail }) => {
        localStorage.setItem('timins_picker_tour_seen_v1', '1');
        localStorage.setItem(`timins_picker_whats_new_${version}`, '1');
        localStorage.setItem('timins_picker_columns_v1', JSON.stringify({ left: 320, right: rail }));
      }, { version, rail: scenario.rail });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForFunction(() => document.querySelector('#candidateMiniStat').textContent === '0 个待考虑');
        assert.deepEqual(await page.locator('.rightbar > .rightbar-section').evaluateAll(sections =>
          sections.map(section => section.querySelector('h2,.rightbar-fold-title').textContent)),
        ['购物车', '候选清单', '商品对比', '预算建议']);
        for (const id of ['candidateSection', 'compareSection', 'recommendSection']) {
          assert.equal(await page.locator(`#${id}`).getAttribute('open'), null);
        }
        assert.equal(await page.locator('#cartAnalysisSection').isVisible(), false);
        if (desktop) {
          await checkBounds(page.locator('.rightbar'));
          await page.screenshot({ path: path.join(screenshots, `empty-${scenario.width}-${scenario.rail}.png`) });
        }

        await page.locator('#fileInput').setInputFiles({ name: 'rightbar-test.csv', mimeType: 'text/csv', buffer: Buffer.from('\ufeff' + fixture) });
        await page.locator('#importCheckModal.open').waitFor();
        await page.locator('#confirmImportCheckBtn').click();
        await page.waitForFunction(() => document.querySelectorAll('#cards .card').length === 5);
        for (const name of ['测试徽章', longName, '测试钥匙扣']) {
          await page.locator('#cards .card').filter({ hasText: name }).locator('.qty-plus').click();
        }
        assert.equal(await page.locator('#cartTotalBig').textContent(), '¥97.90');
        assert.equal(await page.locator('#cartMiniStat').textContent(), '3 个商品 · 3 件');
        if (!desktop) await page.locator('#openCartDrawerBtn').click();
        const container = desktop ? page.locator('.rightbar') : page.locator('#cartDrawer');
        const cartList = desktop ? page.locator('#cartList') : page.locator('#cartListMobile');
        const longItem = cartList.locator('.side-item').filter({ hasText: longName });
        assert.equal(await longItem.locator('.side-name').getAttribute('title'), longName);
        await longItem.locator('.side-plus').click();
        assert.equal(await page.locator('#cartTotalBig').textContent(), '¥146.90');
        await page.locator(desktop ? '#cartUndoBtn' : '#cartDrawerUndoBtn').click();
        assert.equal(await page.locator('#cartTotalBig').textContent(), '¥97.90');
        await longItem.locator('.side-qty').fill('8');
        await page.locator(desktop ? '#cartTotalBig' : '#cartTotalBigMobile').click();
        assert.equal(await page.locator('.rightbar-total').getAttribute('data-budget-state'), 'bad');
        assert.match(await page.locator('#budgetHint').textContent(), /已超/);
        await page.locator(desktop ? '#cartUndoBtn' : '#cartDrawerUndoBtn').click();
        await page.locator(desktop ? '.rightbar .cartGroupsToggleBtn' : '#cartDrawer .cartGroupsToggleBtn').click();
        assert.equal(await cartList.locator('.cart-brand-group[open]').count(), 0);
        await page.locator(desktop ? '.rightbar .cartGroupsToggleBtn' : '#cartDrawer .cartGroupsToggleBtn').click();
        assert.equal(await cartList.locator('.cart-brand-group[open]').count(), 2);
        if (!desktop) {
          assert.equal(await page.locator('#cartAnalysisSectionMobile').getAttribute('open'), null);
          await page.locator('#cartAnalysisSectionMobile > summary').click();
          assert.equal(await page.locator('#cartAnalysisMobile').isVisible(), true);
          await page.locator('#cartAnalysisSectionMobile > summary').click();
        }
        await checkBounds(container);
        if (!desktop) await page.locator('#closeCartDrawerBtn').click();

        await page.locator('#cards .card').filter({ hasText: '测试贴纸' }).locator('.candidate-toggle').click();
        assert.equal(await page.locator('#candidateSection').getAttribute('open'), '');
        if (desktop) await page.locator('#candidateSection > summary').click();
        await page.locator('#cards .card').filter({ hasText: '测试抱枕' }).locator('.candidate-toggle').click();
        if (desktop) assert.equal(await page.locator('#candidateSection').getAttribute('open'), null);
        assert.equal(await page.locator('#candidateMiniStat').textContent(), '2 个待考虑');
        if (desktop) await page.locator('#candidateSection > summary').click();
        else await page.locator('#openCandDrawerBtn').click();
        await page.locator(desktop ? '#candidateList' : '#candidateListMobile').locator('.side-item').filter({ hasText: '测试贴纸' }).locator('.side-move-to-cart').click();
        assert.equal(await page.locator('#cartTotalBig').textContent(), '¥110.70');
        await checkBounds(desktop ? page.locator('.rightbar') : page.locator('#candDrawer'));
        if (!desktop) await page.locator('#closeCandDrawerBtn').click();

        for (const name of ['测试徽章', longName]) {
          await page.locator('#cards .card').filter({ hasText: name }).locator('.compare-toggle').click();
        }
        assert.equal(await page.locator('#compareSection').getAttribute('open'), '');
        if (desktop) {
          await page.locator('#compareSection > summary').click();
          await page.locator('#budgetInput').fill('200');
          assert.equal(await page.locator('#compareSection').getAttribute('open'), null);
          await page.locator('#compareSection > summary').click();
          await page.locator('#openCompareBtn').click();
        } else await page.locator('#openCompareBtnMobile').click();
        await page.locator('#compareModal.open').waitFor();
        assert.equal(await page.locator('#compareGrid .compare-card').count(), 2);
        await page.locator('#closeCompareBtn').click();

        if (desktop) {
          await page.locator('#cartAnalysisSection > summary').click();
          await page.locator('#recommendSection > summary').click();
          await page.locator('#openBudgetPlansBtnSide').click();
          await page.locator('#budgetPlansModal.open').waitFor();
          await page.locator('#closeBudgetPlansBtn').click();
        }
        await page.locator('#appearanceSettings > summary').click();
        for (const theme of ['cream', 'light', 'dark']) {
          await page.locator('#themeSelect').selectOption(theme);
          if (desktop) {
            await checkBounds(page.locator('.rightbar'));
            await page.locator('.rightbar').evaluate(el => { el.scrollTop = 0; });
          } else {
            await page.locator('#openCartDrawerBtn').click();
            await page.waitForFunction(() => document.querySelector('#cartDrawer').getBoundingClientRect().bottom <= window.innerHeight + 1);
            await checkBounds(page.locator('#cartDrawer'));
          }
          // Drawer and theme controls use short CSS transitions.
          await page.waitForTimeout(250);
          await page.screenshot({ path: path.join(screenshots, `filled-${scenario.width}-${scenario.rail}-${theme}.png`) });
          if (!desktop) await page.locator('#closeCartDrawerBtn').click();
        }
        if (desktop) {
          await page.locator('#clearCompareBtn').click();
          assert.equal(await page.locator('#compareSection').getAttribute('open'), null);
          await page.locator('#clearCandidatesBtn').click();
          assert.equal(await page.locator('#candidateSection').getAttribute('open'), null);
          await page.locator('#clearSelectionBtn3').click();
          assert.equal(await page.locator('#cartTotalBig').textContent(), '¥0');
          assert.equal(await page.locator('#cartAnalysisSection').isVisible(), false);
          assert.equal(await page.locator('.rightbar-cart-actions').isVisible(), false);
        }
        assert.deepEqual(errors, [], 'No page script errors');
        console.log(`PASS ${scenario.width}px / ${scenario.rail}px rail: folds, cart, quantities, undo, candidates, compare, themes, bounds`);
      } catch (error) {
        await page.screenshot({ path: path.join(screenshots, `failure-${scenario.width}-${scenario.rail}.png`) });
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Screenshots: ${screenshots}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
