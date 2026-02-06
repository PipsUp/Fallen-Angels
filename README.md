# 🔥 Fallen Angels - Solana Meme Coin Volume Spike Detector

A real-time monitoring bot that detects volume spikes on fallen angel tokens (coins that have dropped significantly from their ATH) on the Solana blockchain.

## ✨ Features

- 🚀 **Volume Spike Detection** - Alerts on significant volume increases
- 📉 **Fallen Angel Tracking** - Monitors tokens down 60%+ from ATH
- 💎 **Micro-Cap Support** - Stricter rules for tokens under $100k market cap
- 🎯 **Breakout Alerts** - Detects when tokens recover above 60% threshold
- 🕐 **Smart Cooldowns** - Prevents spam alerts (30-minute milestones)
- 🔊 **Sound Notifications** - Different sounds for volume spikes vs breakouts
- 📊 **Buy Pressure Validation** - Only alerts when buy volume > sell volume

## 📋 Prerequisites

- Node.js v18 or higher
- Jupiter API key
- Solana Tracker API key

## 🛠️ API Keys

### Jupiter API
Get your key at: https://portal.jup.ag/login

### Solana Tracker API
Get your key at: https://www.solanatracker.io/account/data-api 

## 🚀 Installation

1. **Clone the repository**
```bash
   git clone https://github.com/PipsUp/Fallen-Angels
   cd Fallen-Angels
```

2. **Install dependencies**
```bash
   npm install
```

3. **Create config.json**
```bash
   cp config.example.json config.json
```
   
   Edit `config.json` with your API keys (Do not remove ""):
```json
   {
     "jupiterApiKey": "your-jupiter-api-key",
     "solanaTrackerApiKey": "your-solana-tracker-api-key"
   }
```

4. **Add token addresses you would like to monitor to watchlist.txt**
```
   # One token address per line e.g.:
   4TyZGqRLG3VcHTGMcLBoPUmqYitMVojXinAmkL8xpump
   DNnzSTbL8z4x28ji2dDmZKnYAbLf8zcmqiG9UjArpump
```

## 🎮 Usage

**Start the bot:**
```bash
cd Fallen-Angels
node src/fetch-token-data.js
```

The bot will:
- Scan every 5 minutes
- Show countdown timer
- Play sound alerts when spikes detected
- Save all data to `data/` folder

**Stop the bot:**
Press `Ctrl+C`

## 📊 Detection Rules

### Regular Tokens (≥$100k market cap)
- Must be down ≥60% from ATH
- Volume increase ≥15% in last hour
- Buy volume > Sell volume

### Micro-Caps (<$100k market cap)
- Must be down ≥60% from ATH
- Volume increase ≥**50%** in last hour (stricter!)
- Buy volume > Sell volume

### Breakouts
- Token pumps above 60% drawdown threshold
- Triggers during cooldown OR normal monitoring
- Removes token from monitoring

## 📁 Folder Structure
```
fallen-angels-bot/
├── src/
│   └── fetch-token-data.js     # Main bot script
├── sounds/
│   ├── Wow.wav                 # Volume spike sound
│   └── Alert.wav               # Breakout sound
├── data/                       # Auto-generated data files
│   ├── ath-data.json           # Cached ATH data
│   ├── monitoring-state.json   # Tracking state
│   ├── cooldowns.json          # Cooldown tracker
│   ├── token-history.json      # Historical scans
│   ├── latest-snapshot.json    # Most recent scan
│   └── alerts.json             # All alerts
├── config.json                 # API keys (git-ignored)
├── watchlist.txt               # Tokens to monitor
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

## 🔧 Configuration

Edit thresholds in `src/fetch-token-data.js`:
```javascript
const MIN_DRAWDOWN_PERCENT = 60;                    // Minimum drawdown from ATH
const MIN_VOLUME_CHANGE_PERCENT = 15;               // Regular token threshold
const MIN_VOLUME_CHANGE_PERCENT_MICROCAP = 50;      // Micro-cap threshold
const MIN_MARKET_CAP = 100000;                      // $100k threshold
const SCAN_INTERVAL_MINUTES = 5;                    // Scan frequency
```

## 📝 License

MIT

## ⚠️ Disclaimer

This bot is for educational purposes only. Cryptocurrency trading carries significant risk. Always do your own research and never invest more than you can afford to lose.

## 🤝 Contributing

Contributions welcome! Please open an issue or submit a pull request.

## 💡 Tips

- Start with a small watchlist to test
- Check `data/alerts.json` for historical signals
- Adjust thresholds based on your risk tolerance
- Run on a VPS for 24/7 monitoring

## 📧 Support

Open an issue on GitHub for questions or bug reports.

---

**Happy hunting! 🚀📈**
