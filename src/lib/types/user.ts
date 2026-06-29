// User-related types.

export type UserRole = 'admin' | 'user';

export interface SessionUser {
	id: string;
	email: string;
	name?: string;
	username?: string;
	role: UserRole;
}
