import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit() // ห้ามส่งออปชันเข้าไปในนี้ เพื่อให้ยอมอ่าน svelte.config.js
    ],
    build: {
        sourcemap: false // ยึดมั่นปิดช่องโหว่ซอร์สโค้ดหลุดไว้ตรงนี้
    }
});