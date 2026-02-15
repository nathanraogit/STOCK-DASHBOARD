// bar-chart-sector.js
const fs = require('fs');
const { chromium } = require('playwright');
const cron = require('node-cron');

// Prevent silent death from unhandled rejections (very important in Node 24+)
process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION (this can kill async loops):', reason);
  // Do NOT exit — keep running
});

console.log(`Scheduler started — ${new Date().toISOString()} — every 15 minutes`);

async function scrapeTarget(target) {
  console.log(`\n=== TARGET START === ${target.filePath}`);
  console.log(`URL: ${target.pageUrl}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,      // set to true in production
      slowMo: 50,           // remove or set to 0 later
      timeout: 120000
    });

    const page = await browser.newPage();

    let captured = false;

    await page.route('**/core-api/v1/quotes/get**', async (route) => {
      const url = new URL(route.request().url());
      url.searchParams.set(
        'fields',
        'symbol,symbolName,percentChange,industry,percentChange5d,percentChange1m,percentChange3m,percentChange6m,marketCap,nextEarningsDate'
      );
      console.log(`[ROUTE] ${url.toString()}`);
      await route.continue({ url: url.toString() });
    });

    page.on('response', async (response) => {
      if (response.url().includes('/core-api/v1/quotes/get') && !captured) {
        captured = true;
        try {
          const json = await response.json();
          console.log(`[CAPTURED] ${target.filePath} – status ${response.status()}`);

          if (json.data?.length > 0) {
            console.log(`[KEYS]`, Object.keys(json.data[0]));
            if (json.data[0].raw) console.log(`[RAW KEYS]`, Object.keys(json.data[0].raw));
          }

          const simplifiedData = json.data.map(item => ({
            symbol: item.symbol,
            name: item.symbolName || item.name || (item.raw?.symbolName || item.raw?.name) || 'N/A',
            percentChange: item.percentChange,
            industry: item.industry || (item.raw?.industry) || 'N/A',
            percentChange5d: item.percentChange5d ?? item.raw?.percentChange5d ?? null,
            percentChange1m: item.percentChange1m ?? item.raw?.percentChange1m ?? null,
            percentChange3m: item.percentChange3m ?? item.raw?.percentChange3m ?? null,
            percentChange6m: item.percentChange6m ?? item.raw?.percentChange6m ?? null,
            marketCap: item.marketCap ?? item.raw?.marketCap ?? null,
            nextEarningsDate: item.nextEarningsDate ?? item.raw?.nextEarningsDate ?? 'N/A'
          }));

          fs.writeFileSync(target.filePath, JSON.stringify(simplifiedData, null, 2));
          console.log(`[SAVED] ${simplifiedData.length} items → ${target.filePath}`);
        } catch (e) {
          console.error(`[PARSE ERROR] ${target.filePath}: ${e.message}`);
        }
      }
    });

    console.log(`[GOTO] ${target.pageUrl}`);
    await page.goto(target.pageUrl, { waitUntil: 'networkidle', timeout: 90000 });
    console.log(`[LOADED] ${target.pageUrl}`);

    // Trigger scroll if needed
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(5000);

    // Wait for capture
    let waited = 0;
    const maxWait = 60000;
    while (!captured && waited < maxWait) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
    }

    if (!captured) {
      console.warn(`[NO CAPTURE] ${target.filePath} after ${waited/1000}s`);
    }
  } catch (err) {
    console.error(`[ERROR] ${target.filePath}: ${err.message}`);
    console.error(err.stack || '');
  } finally {
    if (browser) {
      await browser.close().catch(e => console.log(`[CLOSE] Ignored error: ${e.message}`));
    }
    console.log(`=== TARGET END === ${target.filePath}\n`);
  }
}

async function runFullCycle() {
  console.log(`\n=== CYCLE START ${new Date().toISOString()} ===`);

  const targets = [
    { pageUrl: 'https://www.barchart.com/stocks/performance/percent-change/advances', filePath: 'todays-percentage-gainers.json' },
    { pageUrl: 'https://www.barchart.com/stocks/most-active/price-volume-leaders?viewName=139730&orderBy=percentChange&orderDir=desc', filePath: 'large_active_dollarvolume.json' },
    { pageUrl: 'https://www.barchart.com/stocks/performance/five-day-gainers/advances?viewName=139730&orderBy=percentChange&orderDir=desc', filePath: 'five_day_gainers.json' }
  ];

  for (let i = 0; i < targets.length; i++) {
    console.log(`\n[STEP ${i+1}/${targets.length}]`);
    await scrapeTarget(targets[i]);
  }

  console.log(`=== CYCLE COMPLETE ${new Date().toISOString()} ===\n`);
}

// Run immediately
runFullCycle().catch(err => {
  console.error('Initial cycle crashed:', err);
});

// Every 15 minutes
cron.schedule('*/15 * * * *', () => {
  runFullCycle().catch(err => {
    console.error('Scheduled cycle crashed:', err);
  });
});

console.log("Waiting for next cycle...");