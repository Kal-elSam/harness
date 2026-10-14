exports.parse = text => Object.fromEntries(text.split('\n').map(line=>line.split('=')));

