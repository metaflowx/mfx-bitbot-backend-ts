import { generateKeyPairSync } from 'node:crypto';
import {writeFileSync, mkdirSync, existsSync} from 'node:fs'
import { join } from 'node:path';

const generateRSAKeyPair = () => {
    
    /// Bun supports `NODE_ENV` (default: 'development')
    const env = Bun.env.NODE_ENV === 'production' ? 'prod' : 'dev';
    const configDir = join(import.meta.dir, '../src/config', env);

    /// Ensure directory exists (Bun's `mkdirSync` is similar to Node's)
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }
    const PUBLIC_KEY = join(configDir, 'AccessTokenPublicKey.pem');
    const PRIVATE_KEY = join(configDir, 'AccessTokenPrivateKey.pem');

    if (existsSync(PUBLIC_KEY) || existsSync(PRIVATE_KEY)) {
        console.log(`RSA keys already exist in ${configDir}, skipping generation.`);
        return;
    }
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 4096,
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem',
        },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: 'aes-256-cbc',
            passphrase: Bun.env.SECURE_KEYPAIR_PASSPHRASE || process.env.SECURE_KEYPAIR_PASSPHRASE 
        },
    })
    /// Save keys (Bun's `writeFileSync` is faster than Node's)
    writeFileSync(join(configDir, 'AccessTokenPublicKey.pem'), publicKey);
    writeFileSync(join(configDir, 'AccessTokenPrivateKey.pem'), privateKey);
}


const main = async () => {
    generateRSAKeyPair()
}

main().catch(err => {
    console.error('JWT Key generation failed:', err);
    process.exit(1);
});