const axios = require('axios');

async function getTokenPrice(tokenMintAddress) {
  const apiKey = 'YOUR_ALCHEMY_API_KEY';
  const baseURL = `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
  
  try {
    const response = await axios.get(`${baseURL}/getTokenPrice`, {
      params: {
        address: tokenMintAddress
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error fetching token price:', error);
    throw error;
  }
}

// Example usage for SOL token
const solMintAddress = 'So11111111111111111111111111111111111111112'; // SOL mint address
getTokenPrice(solMintAddress)
  .then(priceData => console.log('Token price data:', priceData))
  .catch(err => console.error('Failed to get price:', err));