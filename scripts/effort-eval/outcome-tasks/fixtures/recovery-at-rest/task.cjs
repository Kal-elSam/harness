const fs=require('node:fs'); exports.save=(file,codes)=>fs.writeFileSync(file,JSON.stringify(codes)); exports.consume=(file,code)=>JSON.parse(fs.readFileSync(file)).includes(code);

