import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';
export default defineConfig({
 plugins:[react()],
 root:path.resolve(import.meta.dirname,'preview/first-chapter'),
 publicDir:path.resolve(import.meta.dirname,'client/public'),
 resolve:{alias:{'@':path.resolve(import.meta.dirname,'client/src'),'@shared':path.resolve(import.meta.dirname,'shared')}},
 server:{host:'127.0.0.1',port:5191,strictPort:true,fs:{allow:[import.meta.dirname,'/Users/adamwrightpfi/Desktop/Cursor_bldg-admin-api/node_modules']}},
 build:{outDir:path.resolve(import.meta.dirname,'tmp/first-chapter-build'),emptyOutDir:true},
});
