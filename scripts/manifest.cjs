const {validate}=require('@forge/manifest');
const path=require('node:path');
(async()=>{
  const result=await validate(false,path.resolve('manifest.yml'));
  for(const e of result.errors??[]) console.log(`${e.level}: ${e.message}`);
  console.log(`Forge manifest: ${result.success?'valid':'invalid'}`);
  process.exit(result.success?0:1);
})();
