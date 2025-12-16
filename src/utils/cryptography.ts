import {
    randomBytes,
    scryptSync,
    createCipheriv,
    publicEncrypt,
    privateDecrypt,
    createDecipheriv
} from 'node:crypto'
import { loadRSAKeyPair } from './loadRSAKeyPair';


/// Generate a random salt
const  generateSalt= (): string => {
    /// 16 bytes = 128 bits
    return randomBytes(16).toString('hex');
}

/// Derive IV from userId and salt using a key derivation function (KDF)
const deriveIV = (userId: string, salt: string): Buffer  => {
    /// 16 bytes = 128 bits
    return scryptSync(userId, salt, 16);
}

/// Generate a random symmetric key for AES: step1
const generateSymmetricKey = (): string => {
    /// 256-bit key for AES-256
    return randomBytes(32).toString('hex');
};

/// Encrypt data using AES: step2
const encryptWithAES = (key: string, data: string, userId: string, salt: string): string => {
    /// Initialization vector
    const iv = deriveIV(userId, salt);
    const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag(); /// <-- must be called here
    
    /// Append tag (hex) to the encrypted string so we can use it in decryption
    return encrypted + tag.toString('hex');
}

/// Encrypt symmetric key using RSA public key: step3
const encryptWithRSA = (publicKey: string, data: string): string => {
    const buffer = Buffer.from(data, 'utf8');
    const encrypted = publicEncrypt(publicKey, buffer);
    return encrypted.toString('base64');
};

/// Decrypt symmetric key using RSA private key: step4
const decryptWithRSA = (privateKey: string, encryptedData: string): string => {
    const buffer = Buffer.from(encryptedData, 'base64');
    const decrypted = privateDecrypt({key: privateKey,passphrase: Bun.env.SECURE_KEYPAIR_PASSPHRASE || process.env.SECURE_KEYPAIR_PASSPHRASE}, buffer);
    return decrypted.toString('utf8');
};

/// Decrypt data using AES: step5
const decryptWithAES = (key: string, encryptedData: string, userId: string, salt: string): string => {
    const iv = deriveIV(userId, salt);
    
    const encryptedBuffer = Buffer.from(encryptedData, 'hex');
    const tag = encryptedBuffer.slice(-16); /// last 16 bytes
    const ciphertext = encryptedBuffer.slice(0, -16);

    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);

    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

/// Hybrid encryption: Encrypt data using AES and encrypt the symmetric key using RSA
export const hybridEncryptWithRSA = (
    publicKey: string,
    data: string,
    userId: string
): {
    encryptedData: string;
    encryptedSymmetricKey: string;
    salt: string;
} => {
    /// Step 1: Generate a symmetric key
    const symmetricKey = generateSymmetricKey();

    /// Step 2: Generate a salt
    const salt = generateSalt();

    /// Step 3: Encrypt the data with AES
    const encryptedData = encryptWithAES(symmetricKey, data, userId, salt);

    /// Step 4: Encrypt the symmetric key with RSA
    const encryptedSymmetricKey = encryptWithRSA(publicKey, symmetricKey);

    return {
        encryptedData,
        encryptedSymmetricKey,
        salt,
    };
};

/// Hybrid decryption: Decrypt the symmetric key using RSA and then decrypt the data using AES
export const hybridDecryptWithRSA = (
    privateKey: string,
    encryptedData: string,
    encryptedSymmetricKey: string,
    userId: string,
    salt: string
): string => {
    try {
        /// Step 1: Decrypt the symmetric key with RSA
        const symmetricKey = decryptWithRSA(privateKey, encryptedSymmetricKey);

        /// Step 2: Decrypt the data with AES
        const decryptedData = decryptWithAES(symmetricKey, encryptedData, userId, salt);

        return decryptedData;
    } catch (error) {
        console.error('Decryption failed:', error);
        throw new Error('Failed to decrypt data');
    }
}

const data = "lol"
const userId= "1"

//  const { pubKey: AccessTokenPublicKey, privateKey: AccessTokenPrivateKey } = loadRSAKeyPair();

// const encrypted = hybridEncryptWithRSA(AccessTokenPublicKey, data, userId);
// console.log('Encrypted:', encrypted);

// const decrypted = hybridDecryptWithRSA(AccessTokenPrivateKey, encrypted.encryptedData, encrypted.encryptedSymmetricKey, userId, encrypted.salt);
// console.log('Decrypted:', decrypted);

// /// Test
// if (decrypted === data) {
//     console.log('Success: Decrypted data matches original');
// } else {
//     console.log('Failure: Decrypted data does not match original');
// }    

