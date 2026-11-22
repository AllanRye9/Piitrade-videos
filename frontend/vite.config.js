import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    // Transpile down to a target that still covers older-but-common
    // mobile browsers (e.g. Safari on a few-year-old iPhone) instead of
    // Vite's default "evergreen only" esnext-ish target, so the app
    // doesn't ship syntax that silently fails to parse on them.
    build: {
        target: ['es2018', 'safari12'],
    },
    server: {
        host: true,
        port: 5173,
        proxy: {
            '/api': { target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
            '/uploads': { target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true },
        },
    },
});
