const fs = require('fs');
const { chromium } = require('playwright');
const cron = require('node-cron');

process.on('unhandledRejection', (reason) => {
    console.error('UNHANDLED REJECTION:', reason);
});

console.log(`Scheduler started — ${new Date().toISOString()} — every 15 minutes`);

async function scrapeTarget(target) {
    console.log(`\n=== TARGET START === ${target.filePath || target.name}`);
    let browser;
    let results = [];
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        let captured = false;

        await page.route('**/core-api/v1/quotes/get**', async (route) => {
            const url = new URL(route.request().url());
            // RESTORED ALL ORIGINAL FIELDS IN THE API REQUEST
            url.searchParams.set('fields', 'symbol,symbolName,percentChange,industry,percentChange5d,percentChange1m,percentChange3m,percentChange6m,marketCap,nextEarningsDate');
            url.searchParams.set('max', '100');
            await route.continue({ url: url.toString() });
        });

        page.on('response', async (response) => {
            if (response.url().includes('/core-api/v1/quotes/get') && !captured) {
                try {
                    const json = await response.json();
                    if (json.data && json.data.length > 20) {
                        captured = true;
                        // RESTORED YOUR ORIGINAL MAPPING LOGIC
                        results = json.data.map(item => ({
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
                        console.log(`[DATA] Successfully captured ${results.length} stocks.`);
                    }
                } catch (e) {}
            }
        });

        await page.goto(target.pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('.bc-table-scrollable-inner', { timeout: 15000 }).catch(() => {});
        await page.evaluate(() => window.scrollBy(0, 600));

        let waited = 0;
        while (!captured && waited < 15000) {
            await new Promise(r => setTimeout(r, 1000));
            waited += 1000;
        }
        return results;
    } catch (err) {
        console.error(`[ERROR] ${target.name || target.filePath}: ${err.message}`);
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

async function runFullCycle() {
    console.log(`\n=== CYCLE START ${new Date().toISOString()} ===`);

    const singleTargets = [
        { pageUrl: 'https://www.barchart.com/stocks/performance/percent-change/advances', filePath: 'todays-percentage-gainers.json' },
        { pageUrl: 'https://www.barchart.com/stocks/most-active/price-volume-leaders?viewName=139730&orderBy=percentChange&orderDir=desc', filePath: 'large_active_dollarvolume.json' }
    ];

    for (const target of singleTargets) {
        const data = await scrapeTarget(target);
        if (data.length > 0) {
            fs.writeFileSync(target.filePath, JSON.stringify(data, null, 2));
            console.log(`[SAVED] ${target.filePath}`);
        }
    }

    const fiveDaySources = [
        { name: 'Russell 1000', pageUrl: 'https://www.barchart.com/stocks/indices/russell/russell1000?viewName=139730&orderBy=percentChange5d&orderDir=desc' },
        { name: 'S&P 500', pageUrl: 'https://www.barchart.com/stocks/indices/sp/sp500?viewName=139730&orderBy=percentChange5d&orderDir=desc' },
        { name: 'Nasdaq 100', pageUrl: 'https://www.barchart.com/stocks/indices/nasdaq/nasdaq100?viewName=139730&orderBy=percentChange5d&orderDir=desc' }
    ];

    let combinedFiveDay = [];
    for (const source of fiveDaySources) {
        const data = await scrapeTarget(source);
        combinedFiveDay.push(...data);
    }

    if (combinedFiveDay.length > 0) {
        const uniqueMap = new Map();
        combinedFiveDay.forEach(item => uniqueMap.set(item.symbol, item));
        
        // Final sort by 5D performance so your list of 233 is ordered by the biggest gainers
        const finalFiveDay = Array.from(uniqueMap.values())
            .sort((a, b) => (b.percentChange5d || 0) - (a.percentChange5d || 0));
        
        fs.writeFileSync('five_day_gainers.json', JSON.stringify(finalFiveDay, null, 2));
        console.log(`[SAVED] Combined ${finalFiveDay.length} unique items with full performance history.`);
    }

    console.log(`=== CYCLE COMPLETE ===\n`);
}

runFullCycle();
cron.schedule('*/15 * * * *', runFullCycle);
