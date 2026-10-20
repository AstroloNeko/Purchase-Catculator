const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const screenshots = path.join(os.tmpdir(), 'purchase-calculator-sidebar-v67');
const longBrand = '这是一个用于检查窄栏显示的较长品牌名称';
const fixture = [
  '商品编号,商品名称,品牌,规格/尺寸,单价,库存,图片',
  'TEST001,测试徽章,测试品牌,58mm,19.9,10,',
  'TEST002,测试保温杯,测试品牌,300ml,49,5,',
  `TEST003,测试钥匙扣,${longBrand},小号,29,8,`,
  'TEST004,测试贴纸,另一个品牌,一套,12.8,20,'
].join('\n');

async function checkBounds(page) {
  const problems = await page.locator('.sidebar').evaluate(sidebar => {
    const bounds = sidebar.getBoundingClientRect();
    return [...sidebar.querySelectorAll('input,select,textarea,button,summary')]
      .filter(el => el.getClientRects().length && el.getBoundingClientRect().width)
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
      })
      .map(el => el.id || el.textContent.trim().slice(0, 30));
  });
  assert.deepEqual(problems, [], 'Sidebar controls must stay inside the sidebar');
}

async function waitCards(page, count) {
  await page.waitForFunction(expected => document.querySelectorAll('#cards .card').length === expected, count);
}

async function run() {
  const html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  const version = html.match(/<meta name="app-version" content="([^"]+)"/)[1];
  await fs.mkdir(screenshots, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1600, 1250, 390].filter(value => !process.env.SIDEBAR_TEST_WIDTH || value === Number(process.env.SIDEBAR_TEST_WIDTH))) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.addInitScript(({ testWidth, version }) => {
        localStorage.setItem('timins_picker_tour_seen_v1', '1');
        localStorage.setItem(`timins_picker_whats_new_${version}`, '1');
        if (testWidth === 1250) {
          localStorage.setItem('timins_picker_columns_v1', JSON.stringify({ left: 260, right: 320 }));
        }
      }, { testWidth: width, version });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
      await page.waitForFunction(() => document.querySelector('#brandCount').textContent === '全部品牌');

      const headings = await page.locator('.sidebar > .sidebar-section').evaluateAll(sections =>
        sections.map(section => section.querySelector('h2,summary').textContent.trim()));
      assert.deepEqual(headings, ['导入清单', '预算与筛选', '导出订单', '外观设置', '高级设置']);
      assert.equal(await page.locator('.sidebar details details').count(), 0);
      for (const id of ['appearanceSettings', 'advancedSettings', 'brandFilterSection', 'typeFilterSection']) {
        assert.equal(await page.locator(`#${id}`).getAttribute('open'), null);
      }
      await checkBounds(page);
      await page.screenshot({ path: path.join(screenshots, `sidebar-${width}-cream.png`) });

      await page.locator('#fileInput').setInputFiles({
        name: 'sidebar-test.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('\ufeff' + fixture)
      });
      await page.locator('#importCheckModal.open').waitFor();
      await page.locator('#confirmImportCheckBtn').click();
      await waitCards(page, 4);

      await page.locator('#budgetInput').fill('150');
      assert.equal(await page.locator('#budgetShow').textContent(), '¥150');
      await page.locator('#brandFilterSection > summary').click();
      await page.locator('#brandFilters').getByRole('checkbox', { name: longBrand, exact: true }).check();
      assert.equal(await page.locator('#brandCount').textContent(), longBrand);
      await waitCards(page, 1);
      await page.locator('#brandFilterSection > summary').click();
      assert.equal(await page.locator('#brandFilterSection').getAttribute('open'), null);
      assert.equal(await page.locator('#brandCount').getAttribute('title'), longBrand);
      await checkBounds(page);
      await page.locator('#brandFilterSection > summary').click();
      await page.locator('#clearBrandFiltersBtn').click();
      await waitCards(page, 4);
      await page.locator('#brandFilters').getByRole('checkbox', { name: '测试品牌', exact: true }).check();
      await page.locator('#brandFilters').getByRole('checkbox', { name: longBrand, exact: true }).check();
      assert.equal(await page.locator('#brandCount').textContent(), '已选 2 个品牌');
      await page.locator('#clearBrandFiltersBtn').click();
      await page.locator('#brandFilterSection > summary').click();

      await page.locator('#typeFilterSection > summary').click();
      await page.locator('#typeFilters').getByRole('checkbox', { name: '徽章/胸针', exact: true }).check();
      await waitCards(page, 1);
      assert.equal(await page.locator('#typeCount').textContent(), '徽章/胸针');
      await page.locator('#clearTypeFiltersBtn').click();
      await page.locator('#typeFilterSection > summary').click();

      await page.locator('#priceFilterSection > summary').click();
      await page.locator('#priceBinGrid button').first().click();
      assert.notEqual(await page.locator('#priceRangeLabel').textContent(), '全部价位');
      await page.locator('#priceBinGrid button').first().click();
      await page.locator('#priceFilterSection > summary').click();
      await page.locator('#sortSelect').selectOption('priceAsc');
      await page.locator('#viewModeSelect').selectOption('onlyAffordable');

      await page.locator('#appearanceSettings > summary').click();
      for (const theme of ['light', 'dark', 'cream']) {
        await page.locator('#themeSelect').selectOption(theme);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        await page.locator('#advancedSettings > summary').click();
        assert.equal(await page.locator('#mapName').isVisible(), true);
        assert.equal(await page.locator('#typeKeywordInput').isVisible(), true);
        await checkBounds(page);
        await page.locator('#advancedSettings > summary').click();
        if (theme === 'dark') {
          await page.screenshot({ path: path.join(screenshots, `sidebar-${width}-dark.png`) });
        }
      }
      await page.locator('#cardDensitySelect').selectOption('comfy');
      assert.equal(await page.locator('html').getAttribute('data-density'), 'comfy');
      await page.locator('#appearanceSettings > summary').click();

      await page.locator('#cards .card').first().click();
      await page.locator('#copyOrderBtn').click();
      await page.locator('#orderPreviewModal.open').waitFor();
      assert.equal(await page.locator('#orderBuyerInput').isVisible(), true);
      await page.locator('#cancelOrderPreviewBtn').click();
      await page.locator('#startTourBtn').click();
      for (let step = 0; step < 8; step += 1) {
        await page.waitForFunction(() => {
          const rect = document.querySelector('#tourSpotlight').getBoundingClientRect();
          return rect.width > 5 && rect.height > 5;
        }).catch(async error => {
          await page.screenshot({ path: path.join(screenshots, `tour-failure-${width}-${step + 1}.png`) });
          console.error(await page.locator('#tourTooltip').innerText());
          throw error;
        });
        assert.equal(await page.locator('#tourProgress').textContent(), `第 ${step + 1} 步，共 8 步`);
        await page.locator('#tourNextBtn').click();
      }
      assert.equal(await page.locator('#tourOverlay').getAttribute('aria-hidden'), 'true');
      assert.deepEqual(errors, [], 'No page script errors');
      console.log(`PASS ${width}px: order, folds, import, filters, budget, export, themes, tutorial, bounds`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`Screenshots: ${screenshots}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
