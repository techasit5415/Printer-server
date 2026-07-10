import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    preprocess: vitePreprocess(),

    kit: {
        // ย้าย adapter และ bodySizeLimit มาไว้ตรงนี้ให้ถูกต้องตามมาตรฐาน SvelteKit
        adapter: adapter({
            bodySizeLimit: 100 * 1024 * 1024 // 100MB
        })
    }
};

export default config;