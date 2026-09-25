const fs = require('fs');
const code = fs.readFileSync('script.js', 'utf8');

let stack = [];
for (let i = 0; i < code.length; i++) {
  const char = code[i];
  if (char === '{' || char === '(' || char === '[') {
    stack.push({ char, line: code.slice(0, i).split('\n').length });
  } else if (char === '}' || char === ')' || char === ']') {
    if (stack.length === 0) {
      console.log(`Extra closing ${char} at line ${code.slice(0, i).split('\n').length}`);
      process.exit(1);
    }
    const last = stack.pop();
    const pairs = { '}': '{', ')': '(', ']': '[' };
    if (last.char !== pairs[char]) {
      console.log(`Mismatch: expected ${pairs[char]} but got ${last.char} at line ${code.slice(0, i).split('\n').length}`);
      process.exit(1);
    }
  }
}

if (stack.length > 0) {
  console.log('Unclosed brackets:');
  stack.forEach(s => console.log(`${s.char} at line ${s.line}`));
} else {
  console.log('All good!');
}
