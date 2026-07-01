// User-related types.

export type UserRole = 'superadmin' | 'admin' | 'user';

export interface SessionUser {
	id: string;
	email: string;
	name?: string;
	username?: string;
	role: UserRole;
}
