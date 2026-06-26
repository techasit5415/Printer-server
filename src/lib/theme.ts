// Theme store — toggles classes on <html> and persists to localStorage.
// Two named palettes: "midnight" (default) and "light".

import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'midnight' | 'light';

const STORAGE_KEY = 'lease-theme';

function read(): Theme {
	if (!browser) return 'midnight';
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		return stored === 'light' ? 'light' : 'midnight';
	} catch {
		return 'midnight';
	}
}

function apply(value: Theme) {
	if (!browser) return;
	const root = document.documentElement;
	root.classList.remove('theme-midnight', 'theme-light');
	root.classList.add(value === 'light' ? 'theme-light' : 'theme-midnight');
	try {
		localStorage.setItem(STORAGE_KEY, value);
	} catch {
		/* storage may be blocked */
	}
}

function createThemeStore(): Writable<Theme> & {
	toggle: () => void;
	set: (v: Theme) => void;
} {
	const store = writable<Theme>(read());

	if (browser) {
		store.subscribe((value) => apply(value));
	}

	return {
		...store,
		toggle: () => {
			store.update((v) => (v === 'midnight' ? 'light' : 'midnight'));
		},
		set: (v) => store.set(v)
	};
}

export const theme = createThemeStore();
