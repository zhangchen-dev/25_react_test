const fs=require('fs');
const s=fs.readFileSync('src/page/fast-html/playWright.js','utf8');
let stack=[];
for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(ch==='\\'){i++; continue;} // skip escaped
  if(ch==='"' || ch==="'"){
    const q=ch; i++; while(i<s.length && !(s[i]===q && s[i-1]!=='\\')) i++; continue;
  }
  if(ch==='`'){
    if(stack.length && stack[stack.length-1].ch==='`') stack.pop(); else stack.push({ch:'`',i});
    continue;
  }
  if(ch==='{'||ch==='('||ch==='[') stack.push({ch,i});
  if(ch==='}'||ch===')'||ch===']'){
    const top=stack.pop();
    if(!top){console.log('extra closing',ch,'at',i); break;}
    const pairs={'{':'}','(':')','[':']','`':'`'};
    if(pairs[top.ch]!==ch){console.log('mismatch',top.ch, 'at', top.i, 'vs', ch, 'at', i); break;}
  }
}
console.log('stack length',stack.length);
console.log(stack.slice(-10));
if(stack.length){
  const pos = stack[stack.length-1].i;
  const s=fs.readFileSync('src/page/fast-html/playWright.js','utf8');
  const before = s.slice(Math.max(0,pos-120), pos+120);
  const linesBefore = s.slice(0,pos).split('\n');
  console.log('pos',pos,'line',linesBefore.length);
  console.log('context:\n----\n'+before+'\n----');
}
