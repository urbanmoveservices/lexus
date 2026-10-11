const fs = require('node:fs'), path = require('node:path');
const file = path.join(__dirname, 'lexus-config.json');
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
if (config.licenseUrl && !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(config.licenseUrl)) throw Error('Invalid hosted license URL');
module.exports = config;
