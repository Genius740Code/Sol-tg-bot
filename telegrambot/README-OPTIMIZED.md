# Solana Telegram Bot - Optimized Version

This is an optimized version of the Solana Telegram Bot with improved performance, security, and maintainability.

## Key Improvements

1. **Single API Integration**
   - Consolidated all external API calls to use Helius API exclusively
   - Improved error handling and rate limiting support
   - Automatic retries with exponential backoff

2. **Centralized Settings Database**
   - All configuration moved from config files to database
   - Secure storage of sensitive data
   - Dynamic configuration without restarts

3. **Enhanced Security**
   - Improved encryption with GCM mode for private keys
   - JWT-based authentication
   - Rate limiting protection
   - Input validation

4. **Instant SOL Balance and Price Loading**
   - In-memory caching of balances and prices
   - Automatic background refreshing for active users
   - Optimized loading times

5. **Code Cleanup**
   - Removed unused files and directories
   - Standardized code style
   - Improved error handling

## Setup Instructions

### Prerequisites

- Node.js 16.x or later
- MongoDB 4.4 or later
- Helius API key

### Installation

1. **Run the optimization script**:
   ```
   optimize.bat
   ```
   Or on Linux/Mac:
   ```
   node scripts/setup-optimized.js
   ```

2. **Install dependencies**:
   ```
   npm install
   ```

3. **Start the bot**:
   ```
   npm start
   ```

### Configuration

All configuration is now stored in the MongoDB database. The first time you run the bot, it will migrate settings from your existing `.env` file to the database.

You can view and modify settings directly in the database in the `settings` collection.

## Usage

### Key Commands

The bot functionality remains the same, but with improved performance and security.

- **SOL Balance**: Instantly view your SOL balance with real-time prices
- **Tokens**: View all tokens in your wallet with detailed information
- **Trading**: Quickly buy and sell tokens with improved security
- **Settings**: Configure your wallet and bot preferences

## Performance Optimization

### Cache Configuration

The cache TTL settings can be adjusted in the database:

- `cache_ttl_short`: For frequently changing data (default: 60s)
- `cache_ttl_medium`: For moderately changing data (default: 300s)
- `cache_ttl_long`: For rarely changing data (default: 3600s)

### Rate Limiting

Rate limits are configurable via the `security_api_rate_limit` setting in the database.

## Security Best Practices

1. Never share your private keys or mnemonic phrases
2. Use the bot's encrypted storage for your wallet information
3. Enable two-factor authentication if available
4. Regularly update the bot to the latest version

## Troubleshooting

If you encounter issues:

1. Check the logs in the `logs` directory
2. Ensure MongoDB is running and accessible
3. Verify your Helius API key is valid
4. Restart the bot if needed

## License

This project is licensed under the MIT License - see the LICENSE file for details. 