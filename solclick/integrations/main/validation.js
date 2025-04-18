import { PublicKey } from '@solana/web3.js';

export function validateSolanaAddress(address) {
  const trimmed = address?.trim();
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  if (!trimmed) return { isValid: false, error: 'Empty' };
  if (!base58Regex.test(trimmed)) return { isValid: false, error: 'Not base58' };

  try {
    const publicKey = new PublicKey(trimmed);
    return { isValid: true, publicKey: publicKey.toString() };
  } catch (err) {
    return { isValid: false, error: err.message || 'Invalid format' };
  }
}
