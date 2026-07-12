import type { AuthenticatedUser, UserRecord } from '../../../shared/domain/types.js'

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>
  findByEmail(email: string): Promise<UserRecord | null>
}

export function toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    cpf: user.cpf,
    isActive: user.isActive,
  }
}
