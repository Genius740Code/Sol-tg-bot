# Telegram SOL Trading Bot

A Telegram bot for trading Solana tokens with wallet management, position tracking, limit orders, and referral system.

## Features

- 🔐 Secure wallet generation and storage with strong encryption
- 💎 Real-time SOL price updates via CoinGecko API (free tier)
- 🔍 Token analysis with Helius API (marketcap, liquidity, volume)
- 📊 Position tracking and management with P/L display
- 📝 Limit order functionality
- 👥 Referral system with 11% fee discount and 35% referral earnings
- ⚙️ Customizable user settings
- 💳 Wallet management and balance display
- 📈 Take profit/stop loss settings
- 🔔 Price alerts

## Prerequisites

- Node.js 14+
- MongoDB Atlas account (free tier works fine)
- Telegram Bot Token (from BotFather)
- Helius API Key (from helius.xyz)

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd telegrambot
```

2. Install dependencies:

```bash
npm install
```

3. Set up your environment variables in the `.env` file:

```
BOT_TOKEN=your_telegram_bot_token
MONGODB_URI=mongodb+srv://username:password@yourcluster.mongodb.net/dbname?retryWrites=true&w=majority
ENCRYPTION_KEY=replace_with_generated_key
HELIUS_API_KEY=your_helius_api_key
```

4. Generate a secure encryption key:

```bash
npm run generate-key
```

This will automatically update your `.env` file with a secure key.

5. Start the bot:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Troubleshooting

### Database Connection Issues

If you see MongoDB connection errors:

1. Check your `MONGODB_URI` in the `.env` file
2. Make sure your IP address is whitelisted in MongoDB Atlas
3. The bot includes a retry mechanism for database connections

### CoinGecko API Issues

The bot now uses the public CoinGecko API which has rate limits. If you're experiencing issues:

1. Consider upgrading to CoinGecko Pro and updating the code in `utils/wallet.js`
2. The bot includes a fallback mechanism for SOL price

### Telegram Bot Issues

If the bot isn't responding:

1. Make sure your `BOT_TOKEN` is correct
2. Check that your bot is running (`npm start`)
3. Try sending `/start` to reset the bot state

## Bot Commands

- `/start` - Start the bot and show main menu
- `/buy` - Buy new tokens
- `/sell` - Sell tokens from your positions
- `/help` - Show help information
- `/settings` - Configure bot settings
- `/positions` - View your trading positions
- `/orders` - View your limit orders
- `/referrals` - View and manage referrals

## Trading Features

### Buy and Sell

The bot implements buy and sell functionality for any Solana token with:
- 0.8% trading fee (0.712% with referral)
- Real-time price data from Helius
- Transaction confirmations

### Positions

View your open positions with:
- Current P/L calculations (both absolute and percentage)
- Token information and current price
- Total portfolio value

### Limit Orders

Create limit orders to:
- Buy at a certain price
- Sell when price reaches targets
- Set take profit and stop loss

## Referral System

The referral system includes:
- 11% discount on fees for referred users (0.8% → 0.712%)
- 35% of fees as earnings for referrers
- Custom referral links and tracking

## Security Considerations

- Private keys are encrypted with AES-256
- Rate limiting to prevent API abuse
- Error handling and logging

## Development Notes

- The bot is designed to handle 1000+ concurrent users
- Code is organized in a modular way for easy maintenance
- Logs are stored in the `logs` directory

## License

MIT

## Disclaimer

This bot is for educational purposes only. Use at your own risk. The creator is not responsible for any financial losses incurred through the use of this software. 