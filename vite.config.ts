import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit({
            compilerOptions: {
                runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
            }
        })
    ],
    // ย้าย bodySizeLimit มาไว้ในส่วน config ของ adapter-node ตรงนี้
    adapter: adapter({
        bodySizeLimit: 100 * 1024 * 1024 // 100MB
    }),
    build: {
        sourcemap: false // ปิด sourcemap อย่างสมบูรณ์
    }
});