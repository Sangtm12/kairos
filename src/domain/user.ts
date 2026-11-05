export type User = {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
  role: UserRoleEnum;
}

export type UserWithPasswordHash = User & {
  passwordHash: string;
}

export type UserRoleEnum = 'customer' | 'provider';