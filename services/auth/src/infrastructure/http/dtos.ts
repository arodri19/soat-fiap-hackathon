import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { PublicUser } from '../../domain/user';
import type { Session } from '../../application/session-issuer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @Transform(trim)
  @IsString({ message: 'Nome é obrigatório' })
  @MinLength(2, { message: 'Nome deve ter ao menos 2 caracteres' })
  @MaxLength(120, { message: 'Nome deve ter no máximo 120 caracteres' })
  name: string;

  @Transform(trim)
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(255, { message: 'E-mail deve ter no máximo 255 caracteres' })
  email: string;

  // A regra completa (letra + número, limite do bcrypt) fica no domínio.
  @IsString({ message: 'Senha é obrigatória' })
  password: string;
}

export class LoginDto {
  @Transform(trim)
  @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @IsString({ message: 'Senha é obrigatória' })
  @MinLength(1, { message: 'Senha é obrigatória' })
  password: string;
}

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: UserResponse;
}

export const toUserResponse = (user: PublicUser): UserResponse => ({
  id: user.id,
  name: user.name,
  email: user.email,
  created_at: user.createdAt.toISOString(),
});

export const toLoginResponse = (session: Session): LoginResponse => ({
  access_token: session.accessToken,
  token_type: 'Bearer',
  expires_in: session.expiresIn,
  user: toUserResponse(session.user),
});
