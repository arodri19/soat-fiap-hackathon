import { http } from './http';
import type { LoginResponse, User } from './types';

export const authApi = {
  register: (name: string, email: string, password: string) =>
    http.post<User>('/auth/register', { name, email, password }).then((r) => r.data),
  login: (email: string, password: string) =>
    http.post<LoginResponse>('/auth/login', { email, password }).then((r) => r.data),
  refresh: () => http.post<LoginResponse>('/auth/refresh').then((r) => r.data),
  logout: () => http.post<void>('/auth/logout').then(() => undefined),
  me: () => http.get<User>('/auth/me').then((r) => r.data),
};
