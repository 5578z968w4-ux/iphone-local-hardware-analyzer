'use strict';
importScripts('./diag2-core.d2.0.2.js');
const EXPECTED='DIAG-2.0.2';
self.postMessage({type:'ready',version:Diag2.VERSION});
let busy=false;
self.onmessage=async(event)=>{
  if(event.data?.type!=='scan'||busy)return;
  if(Diag2.VERSION!==EXPECTED){self.postMessage({type:'error',code:'VERSION_MISMATCH'});return;}
  busy=true;
  try{
    const report=await Diag2.scanBlob(event.data.file,p=>self.postMessage({type:'progress',...p}));
    self.postMessage({type:'done',report});
  }catch(error){
    const known=new Set(['FILE_REQUIRED','FILE_TOO_LARGE','EMPTY_FILE','COMPRESSED_FILE','UNSUPPORTED_ENCODING']);
    self.postMessage({type:'error',code:known.has(error.message)?error.message:'READ_OR_PARSE_FAILED'});
  }finally{busy=false;}
};
