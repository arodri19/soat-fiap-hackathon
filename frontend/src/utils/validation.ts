/** Regras de formulário e de arquivo (as mesmas validadas no backend). */

export const ALLOWED_EXTENSIONS = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm'] as const;

type Rule = (value: string) => true | string;

export const rules = {
  required:
    (label: string): Rule =>
    (v) =>
      !!v?.trim() || `${label} é obrigatório`,
  email: ((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v?.trim() ?? '') || 'E-mail inválido') as Rule,
  minLength:
    (n: number, label: string): Rule =>
    (v) =>
      (v?.trim().length ?? 0) >= n || `${label} deve ter ao menos ${n} caracteres`,
};

/** Mesma política do auth-service: 8+ caracteres, letra e número, até 72 bytes. */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push('ao menos 8 caracteres');
  if (!/\p{L}/u.test(password)) problems.push('uma letra');
  if (!/\d/.test(password)) problems.push('um número');
  if (new TextEncoder().encode(password).length > 72) problems.push('no máximo 72 bytes');
  return problems;
}

export const passwordRule: Rule = (v) => {
  const p = passwordProblems(v ?? '');
  return p.length === 0 || `A senha precisa de ${p.join(', ')}`;
};

/** 0–4: usado na barra de força da senha no cadastro. */
export function passwordStrength(password: string): number {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/\p{L}/u.test(password) && /\d/.test(password)) score++;
  if (/[^\p{L}\d]/u.test(password) || (/[a-z]/.test(password) && /[A-Z]/.test(password))) score++;
  return score;
}

export function validateVideoFile(file: File, maxMb: number): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!file.name.includes('.') || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Formato não suportado. Use: ${ALLOWED_EXTENSIONS.join(', ')}`;
  }
  if (file.size === 0) return 'Arquivo vazio';
  if (file.size > maxMb * 1024 * 1024) return `Arquivo maior que ${maxMb} MB`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
