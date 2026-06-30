export async function safeUnlink(filePath: string): Promise<void> {
	const { unlink } = await import('node:fs/promises');
	try {
		await unlink(filePath);
	} catch {
		/* ignore — file may already be gone */
	}
}
