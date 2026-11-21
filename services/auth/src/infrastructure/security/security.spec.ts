import { generateKeyPairSync } from 'node:crypto';
import { InvalidSessionError } from '../../domain/errors';
import { BcryptPasswordHasher } from './bcrypt-password-hasher';
import { JoseAccessTokenService } from './jose-access-token-service';
import { CryptoOpaqueTokenGenerator } from './opaque-token-generator';

const settings = { issuer: 'fiapx-auth', audience: 'fiapx', ttlSeconds: 900 };
const claims = {
  sub: '5a1d3c7b-2e4f-4b6a-8c9d-0e1f2a3b4c5d',
  email: 'ana@exemplo.com',
  name: 'Ana',
};

describe('JoseAccessTokenService', () => {
  it('assina e valida um JWT RS256 com kid e claims do contrato', async () => {
    const service = await JoseAccessTokenService.create(settings);

    const { token, expiresIn } = await service.sign(claims);

    expect(expiresIn).toBe(900);
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    expect(header).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: service.keyId });
    expect(payload).toMatchObject({ ...claims, iss: 'fiapx-auth', aud: 'fiapx' });
    expect(payload.exp - payload.iat).toBe(900);
    await expect(service.verify(token)).resolves.toEqual(claims);
  });

  it('publica a chave pública no JWKS (sem partes privadas)', async () => {
    const service = await JoseAccessTokenService.create(settings);
    const { keys } = service.jwks();

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig', kid: service.keyId });
    expect(keys[0]).not.toHaveProperty('d');
  });

  it('carrega a chave PEM informada (mesmo kid entre instâncias)', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    const a = await JoseAccessTokenService.create(settings, pem);
    const b = await JoseAccessTokenService.create(settings, pem);

    expect(a.keyId).toBe(b.keyId);
    const { token } = await a.sign(claims);
    await expect(b.verify(token)).resolves.toEqual(claims);
  });

  it('recusa token de outra chave, adulterado, de outro emissor ou expirado', async () => {
    const service = await JoseAccessTokenService.create(settings);
    const other = await JoseAccessTokenService.create(settings);
    const wrongIssuer = await JoseAccessTokenService.create({ ...settings, issuer: 'outro' });
    const expired = await JoseAccessTokenService.create({ ...settings, ttlSeconds: 1 });

    const fromOther = (await other.sign(claims)).token;
    const { token } = await service.sign(claims);
    const tampered = token.slice(0, -4) + 'abcd';
    const fromWrongIssuer = (await wrongIssuer.sign(claims)).token;

    for (const t of [fromOther, tampered, fromWrongIssuer, 'nao-e-jwt']) {
      await expect(service.verify(t)).rejects.toBeInstanceOf(InvalidSessionError);
    }

    jest.useFakeTimers({ now: Date.now() });
    const short = (await expired.sign(claims)).token;
    jest.setSystemTime(Date.now() + 5_000);
    await expect(expired.verify(short)).rejects.toBeInstanceOf(InvalidSessionError);
    jest.useRealTimers();
  });
});

describe('BcryptPasswordHasher', () => {
  it('gera hash bcrypt e compara corretamente', async () => {
    const hasher = new BcryptPasswordHasher(4);
    const hash = await hasher.hash('senhaForte1');

    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    await expect(hasher.compare('senhaForte1', hash)).resolves.toBe(true);
    await expect(hasher.compare('outraSenha1', hash)).resolves.toBe(false);
  });
});

describe('CryptoOpaqueTokenGenerator', () => {
  it('gera tokens aleatórios de 256 bits e hash sha256 determinístico', () => {
    const gen = new CryptoOpaqueTokenGenerator();
    const a = gen.generate();

    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(gen.generate()).not.toBe(a);
    expect(gen.hash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(gen.hash(a)).toBe(gen.hash(a));
    expect(gen.newId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
