const { PublicKey } = require('@solana/web3.js');

try {
  const publicKey = new PublicKey('');
  console.log('This is a valid Solana address');
} catch (error) {
  console.log('Invalid Solana address');
}
