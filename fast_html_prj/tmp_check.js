const fs = require('fs');
const s = fs.readFileSync('src/page/fast-html/playWright.js','utf8');
const counts = { '{':0,'}':0,'`':0,'"':0,"'":0,'\\':0,'(':0,')':0,'[':0,']':0 };
for(const ch of s){ if(counts.hasOwnProperty(ch)) counts[ch]++; }
console.log(counts);
