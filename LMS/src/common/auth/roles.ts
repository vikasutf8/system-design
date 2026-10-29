export enum UserRole {
  MEMBER = 'MEMBER',
  LIBRARIAN = 'LIBRARIAN',
  ADMIN = 'ADMIN',
}

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  name?: string;
}
