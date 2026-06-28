// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type PocketBase from 'pocketbase';

declare global {
    namespace App {
        // interface Error {}
        interface Locals {
            pb: PocketBase;
            user: {
                id: string;
                email: string;
                name?: string;
                username?: string;
                role: 'admin' | 'user';
                /** PB auth token — kept on the locals payload so server actions
                 * can rehydrate a fresh client without re-validating the cookie. */
                token: string;
                /** User quota information fetched/created during hook resolution */
                quota: {
                    id: string | null;
                    total: number;
                    used: number;
                };
            } | null;
        }
        interface PageData {
            user?: App.Locals['user'];
        }
        // interface PageState {}
        // interface Platform {}
    }
}

export {};