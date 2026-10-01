import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], resolve: { alias: { 'pdfkit-standalone': path.join(path.dirname(require.resolve('pdfkit')), 'pdfkit.standalone.js') } }, server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:3001' } }, build: { outDir: 'dist' } });
