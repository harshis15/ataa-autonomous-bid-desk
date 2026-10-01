import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireLock,Repository} from '../server/storage/database.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.env.ATAA_DATA_DIR||path.join(root,'runtime'));
const target=process.argv[2]&&path.resolve(process.argv[2]);
if(!target||target===source||target.startsWith(source+path.sep)||fs.existsSync(target))throw Error('Supply a new backup folder outside ATAA_DATA_DIR. Usage: npm run data:backup -- /path/to/new-backup');
if(!fs.existsSync(path.join(source,'ataa.sqlite')))throw Error('No database found. Start the app once, then stop it before backing up.');
const release=acquireLock(source);
try{
 const db=new Repository(source);db.close(); // checkpoint WAL before copying, while exclusively locked
 fs.cpSync(source,target,{recursive:true,filter:p=>!['server.lock','ataa.sqlite-wal','ataa.sqlite-shm'].includes(path.basename(p))});
 fs.writeFileSync(path.join(target,'backup-manifest.json'),JSON.stringify({format:'ataa-local-backup',schema_version:1,created_at:new Date().toISOString(),database:'ataa.sqlite',objects:'objects'},null,2));
 console.log('Backup complete: '+target);
}catch(e){console.error('Backup failed. Treat any partial destination as incomplete.');throw e;}finally{release();}
