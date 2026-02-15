// extract_finviz_industry_performance.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://finviz.com/groups.ashx?g=industry&v=210&o=name';

https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
  let html = '';

  res.on('data', (chunk) => {
    html += chunk;
  });

  res.on('end', () => {
    try {
      // Find the rows array using regex
      const match = html.match(/var\s+rows\s*=\s*(\[[\s\S]*?\]);/);
      
      if (!match) {
        console.error('Could not find the rows array in the page.');
        process.exit(1);
      }

      const jsonStr = match[1];
      
      // Parse the extracted string as JSON
      const data = JSON.parse(jsonStr);

      // Pretty-print to console
      console.log(JSON.stringify(data, null, 2));

      // Optionally save to a file
      const outputPath = path.join(__dirname, 'finviz_industry_performance.json');
      fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
      console.log(`\nData saved to: ${outputPath}`);

    } catch (err) {
      console.error('Error parsing JSON:', err.message);
    }
  });

}).on('error', (err) => {
  console.error('Request error:', err.message);
});