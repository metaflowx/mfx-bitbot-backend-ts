import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/// keypair based on RSA

export const loadRSAKeyPair = () => {
    const env = Bun.env.NODE_ENV === 'production' ? 'prod' : 'dev'
    const configDir = join(import.meta.dir, '../config', env)
    
    const PUBLIC_KEY = join(configDir, 'AccessTokenPublicKey.pem');
    const PRIVATE_KEY = join(configDir, 'AccessTokenPrivateKey.pem');

    if(!existsSync(PUBLIC_KEY) || !existsSync(PRIVATE_KEY)) {
        throw new Error('AccessKeyPair not found in PEM file');
    }
    /// Read the public and private keys
   const AccessTokenPublicKey = readFileSync(PUBLIC_KEY, 'utf8');
   const AccessTokenPrivateKey = readFileSync(PRIVATE_KEY, 'utf8');

    return {
        pubKey: AccessTokenPublicKey,
        privateKey: AccessTokenPrivateKey
    }
}

