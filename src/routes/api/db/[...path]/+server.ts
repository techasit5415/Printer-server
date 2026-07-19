import { serverEnv } from '$lib/server/env';
import { error, type RequestHandler } from '@sveltejs/kit';

export const fallback: RequestHandler = async ({ request, params, fetch }) => {
	const pbUrl = serverEnv.pocketbaseUrl;
	// Construct the target URL on the PocketBase server
	const targetUrl = `${pbUrl}/${params.path}${new URL(request.url).search}`;

	// Clone the headers from the incoming request, omitting 'host'
	const headers = new Headers();
	for (const [key, value] of request.headers.entries()) {
		if (key.toLowerCase() !== 'host') {
			headers.set(key, value);
		}
	}

	try {
		const body = request.body ? request.body : undefined;

		// Fetch from the local PocketBase server using SvelteKit's fetch
		const res = await fetch(targetUrl, {
			method: request.method,
			headers,
			body,
			// @ts-ignore
			duplex: body ? 'half' : undefined
		});

		// Return the streamed response back to the client
		return new Response(res.body, {
			status: res.status,
			headers: res.headers
		});
	} catch (err) {
		console.error('[PB Proxy Error]:', err);
		throw error(502, 'Bad Gateway');
	}
};
