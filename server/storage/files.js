import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export class LocalFileStore {
  constructor(directory){this.directory=path.resolve(directory);fs.mkdirSync(this.directory,{recursive:true,mode:0o700});}
  resolve(key){if(!/^[a-f0-9]{2}\/[a-f0-9]{64}$/.test(key))throw Error('Invalid object key.');return path.join(this.directory,key);}
  put(bytes,{bid_id,name,kind,mime}){
    const hash=sha256(bytes),key=hash.slice(0,2)+'/'+hash,target=this.resolve(key);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    if(!fs.existsSync(target)){
      const tmp=target+'.'+randomUUID()+'.tmp';const fd=fs.openSync(tmp,'wx',0o600);
      try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(tmp,target);
    }
    return {id:randomUUID(),bid_id,name:path.basename(name).replace(/[\r\n\x00-\x1f]/g,'_'),kind,mime,key,sha256:hash,bytes:bytes.length,created_at:new Date().toISOString()};
  }
  read(a){const bytes=fs.readFileSync(this.resolve(a.key));if(bytes.length!==a.bytes||sha256(bytes)!==a.sha256)throw Error('Stored file failed its integrity check. Restore it from backup.');return bytes;}
}
