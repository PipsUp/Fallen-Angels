// src/fetch-token-data.js
const fs = require('fs');
const path = require('path');
const player = require('node-wav-player');

// Ensure all required directories exist
function ensureDirectories() {
  const dirs = ['data', 'sounds', 'src'];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Run directory setup
ensureDirectories();

// Load configuration
function loadConfig() {
  try {
    const data = fs.readFileSync('config.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading config.json:', error.message);
    console.log('Make sure config.json exists with your API keys!');
    process.exit(1);
  }
}

const config = loadConfig();
const JUPITER_API_KEY = config.jupiterApiKey;
const SOLANA_TRACKER_API_KEY = config.solanaTrackerApiKey;

// Detection thresholds
const MIN_DRAWDOWN_PERCENT = 60;
const MIN_VOLUME_CHANGE_PERCENT = 15; // For tokens ≥100k mcap
const MIN_VOLUME_CHANGE_PERCENT_MICROCAP = 50; // For tokens <100k mcap
const MIN_MARKET_CAP = 100000; // $100k threshold for regular vs micro-cap
const SCAN_INTERVAL_MINUTES = 5;

// File paths
const PATHS = {
  monitoringState: 'data/monitoring-state.json',
  cooldowns: 'data/cooldowns.json',
  athData: 'data/ath-data.json',
  tokenHistory: 'data/token-history.json',
  latestSnapshot: 'data/latest-snapshot.json',
  alerts: 'data/alerts.json',
  watchlist: 'watchlist.txt',
  soundVolume: 'sounds/Wow.wav',
  soundBreakout: 'sounds/Alert.wav'
};

// Monitoring state functions
function loadMonitoringState() {
  try {
    const data = fs.readFileSync(PATHS.monitoringState, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { monitoredTokens: {} };
  }
}

function saveMonitoringState(state) {
  try {
    fs.writeFileSync(
      PATHS.monitoringState,
      JSON.stringify(state, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Error saving monitoring state:', error.message);
  }
}

function updateMonitoredToken(tokenAddress, tokenSymbol, drawdown) {
  const state = loadMonitoringState();
  
  if (!state.monitoredTokens) {
    state.monitoredTokens = {};
  }
  
  state.monitoredTokens[tokenAddress] = {
    symbol: tokenSymbol,
    lastDrawdown: drawdown,
    lastSeen: new Date().toISOString()
  };
  
  saveMonitoringState(state);
}

function removeMonitoredToken(tokenAddress) {
  const state = loadMonitoringState();
  
  if (state.monitoredTokens && state.monitoredTokens[tokenAddress]) {
    delete state.monitoredTokens[tokenAddress];
    saveMonitoringState(state);
  }
}

function wasTokenMonitoredLastScan(tokenAddress) {
  const state = loadMonitoringState();
  return state.monitoredTokens && state.monitoredTokens[tokenAddress] !== undefined;
}

function getLastDrawdown(tokenAddress) {
  const state = loadMonitoringState();
  if (state.monitoredTokens && state.monitoredTokens[tokenAddress]) {
    return state.monitoredTokens[tokenAddress].lastDrawdown;
  }
  return null;
}

// Clean up monitoring state - remove tokens not in watchlist
function cleanupMonitoringState(currentWatchlist) {
  const state = loadMonitoringState();
  
  if (!state.monitoredTokens) return;
  
  const tokensToRemove = [];
  
  for (const tokenAddress in state.monitoredTokens) {
    if (!currentWatchlist.includes(tokenAddress)) {
      tokensToRemove.push(tokenAddress);
    }
  }
  
  if (tokensToRemove.length > 0) {
    console.log(`🧹 Cleaning up ${tokensToRemove.length} token(s) removed from watchlist...`);
    tokensToRemove.forEach(addr => {
      console.log(`  - Removed ${state.monitoredTokens[addr].symbol} from monitoring`);
      delete state.monitoredTokens[addr];
    });
    saveMonitoringState(state);
  }
}

// Clean up cooldowns - remove tokens not in watchlist
function cleanupCooldowns(currentWatchlist) {
  const cooldowns = loadCooldowns();
  const tokensToRemove = [];
  
  for (const tokenAddress in cooldowns) {
    if (!currentWatchlist.includes(tokenAddress)) {
      tokensToRemove.push(tokenAddress);
    }
  }
  
  if (tokensToRemove.length > 0) {
    tokensToRemove.forEach(addr => {
      console.log(`  - Removed ${cooldowns[addr].symbol} from cooldown`);
      delete cooldowns[addr];
    });
    saveCooldowns(cooldowns);
  }
}

// Cooldown functions
function loadCooldowns() {
  try {
    const data = fs.readFileSync(PATHS.cooldowns, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

function saveCooldowns(cooldowns) {
  try {
    fs.writeFileSync(
      PATHS.cooldowns,
      JSON.stringify(cooldowns, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Error saving cooldowns:', error.message);
  }
}

function getNextCooldownMilestone() {
  const now = new Date();
  const minutes = now.getMinutes();
  
  // If we're at 0-29 minutes, next milestone is :30 of current hour
  // If we're at 30-59 minutes, next milestone is :00 of next hour
  
  if (minutes < 30) {
    now.setMinutes(30, 0, 0); // Set to :30:00.000
  } else {
    now.setHours(now.getHours() + 1, 0, 0, 0); // Set to next hour :00:00.000
  }
  
  return now.toISOString();
}

function isTokenInCooldown(tokenAddress) {
  const cooldowns = loadCooldowns();
  
  if (!cooldowns[tokenAddress]) {
    return false; // No cooldown record
  }
  
  const cooldownUntil = new Date(cooldowns[tokenAddress].cooldownUntil);
  const now = new Date();
  
  if (now < cooldownUntil) {
    // Still in cooldown
    return {
      inCooldown: true,
      until: cooldownUntil.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      initialDrawdown: cooldowns[tokenAddress].drawdownAtAlert
    };
  }
  
  // Cooldown expired
  return false;
}

function addTokenToCooldown(tokenAddress, tokenSymbol, currentDrawdown) {
  const cooldowns = loadCooldowns();
  const now = new Date();
  const cooldownUntil = getNextCooldownMilestone();
  
  cooldowns[tokenAddress] = {
    symbol: tokenSymbol,
    lastAlert: now.toISOString(),
    cooldownUntil: cooldownUntil,
    drawdownAtAlert: currentDrawdown // Store drawdown at time of alert
  };
  
  saveCooldowns(cooldowns);
  
  console.log(`🕐 ${tokenSymbol} added to cooldown until ${new Date(cooldownUntil).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`);
}

function removeCooldown(tokenAddress) {
  const cooldowns = loadCooldowns();
  
  if (cooldowns[tokenAddress]) {
    delete cooldowns[tokenAddress];
    saveCooldowns(cooldowns);
  }
}

// Play alert sound
async function playAlertSound(isBreakout = false) {
  try {
    const soundFile = isBreakout ? PATHS.soundBreakout : PATHS.soundVolume;
    await player.play({
      path: soundFile,
    });
  } catch (error) {
    console.error('⚠️  Could not play sound:', error.message);
  }
}

// Load watchlist from file
function loadWatchlist() {
  try {
    const data = fs.readFileSync(PATHS.watchlist, 'utf8');
    const tokens = data.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
    
    console.log(`Loaded ${tokens.length} tokens from watchlist.txt\n`);
    return tokens;
  } catch (error) {
    console.error('Error loading watchlist.txt:', error.message);
    console.log('Make sure watchlist.txt exists in the same folder!');
    return [];
  }
}

// Load ATH data
function loadATHData() {
  try {
    const data = fs.readFileSync(PATHS.athData, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// Save ATH data
function saveATHData(athData) {
  try {
    fs.writeFileSync(
      PATHS.athData,
      JSON.stringify(athData, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Error saving ATH data:', error.message);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Quick price check (lightweight Jupiter call)
async function getQuickPrice(tokenAddress) {
  try {
    const options = {
      method: 'GET',
      headers: { 'x-api-key': JUPITER_API_KEY }
    };

    const response = await fetch(
      `https://api.jup.ag/tokens/v2/search?query=${tokenAddress}`,
      options
    );

    const data = await response.json();
    
    if (!data || data.length === 0) {
      return null;
    }

    return data[0].usdPrice || 0;
  } catch (error) {
    console.error(`  ⚠️ Error getting price: ${error.message}`);
    return null;
  }
}

// Filter watchlist - only monitor fallen angels (>=60% down)
async function filterWatchlist(watchlist) {
  console.log('🔍 Pre-flight check: Filtering watchlist for fallen angels...\n');
  
  const athData = loadATHData();
  const tokensToMonitor = [];
  const skippedTokens = [];
  const newTokensNeedingATH = [];
  
  for (let i = 0; i < watchlist.length; i++) {
    const tokenAddress = watchlist[i];
    
    // Check if we have ATH data
    if (!athData[tokenAddress]) {
      // New token - need to fetch ATH first to check drawdown
      console.log(`[${i + 1}/${watchlist.length}] ${tokenAddress.slice(0, 8)}... - NEW TOKEN → Need to fetch ATH`);
      newTokensNeedingATH.push(tokenAddress);
    } else {
      // Existing token - check drawdown
      const storedATH = athData[tokenAddress];
      console.log(`[${i + 1}/${watchlist.length}] ${tokenAddress.slice(0, 8)}... - Checking drawdown...`);
      
      const currentPrice = await getQuickPrice(tokenAddress);
      
      if (currentPrice === null) {
        console.log(`  ⚠️ Could not fetch price, skipping`);
        skippedTokens.push({
          address: tokenAddress,
          reason: 'Could not fetch price'
        });
      } else {
        const drawdown = ((storedATH.athPrice - currentPrice) / storedATH.athPrice) * 100;
        
        if (drawdown >= MIN_DRAWDOWN_PERCENT) {
          console.log(`  ✅ ${drawdown.toFixed(2)}% down from ATH → MONITOR`);
          tokensToMonitor.push(tokenAddress);
        } else {
          console.log(`  ⏭️  ${drawdown.toFixed(2)}% down from ATH → SKIP (< ${MIN_DRAWDOWN_PERCENT}%)`);
          skippedTokens.push({
            address: tokenAddress,
            drawdown: drawdown
          });
        }
      }
    }
    
    // Rate limit for Jupiter API
    if (i < watchlist.length - 1) {
      await delay(1000);
    }
  }
  
  console.log(`\n📊 Filter Results:`);
  console.log(`  ✅ Monitoring: ${tokensToMonitor.length} tokens`);
  console.log(`  🆕 New tokens (will check after ATH fetch): ${newTokensNeedingATH.length}`);
  console.log(`  ⏭️  Skipped: ${skippedTokens.length} tokens`);
  
  if (skippedTokens.length > 0) {
    console.log(`\n  Skipped tokens:`);
    skippedTokens.forEach(t => {
      if (t.drawdown !== undefined) {
        console.log(`    - ${t.address.slice(0, 8)}... (${t.drawdown.toFixed(2)}% down)`);
      } else {
        console.log(`    - ${t.address.slice(0, 8)}... (${t.reason})`);
      }
    });
  }
  
  console.log('');
  
  return {
    confirmed: tokensToMonitor,
    newTokens: newTokensNeedingATH
  };
}

// Fetch ATH data from Solana Tracker API (30-day window) with retry
async function fetchATHData(tokenAddress, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const timeTo = Math.floor(Date.now() / 1000);
      const timeFrom = timeTo - (30 * 24 * 60 * 60); // 30 days ago
      
      const response = await fetch(
        `https://data.solanatracker.io/price/history/range?token=${tokenAddress}&time_from=${timeFrom}&time_to=${timeTo}`,
        {
          headers: { 'x-api-key': SOLANA_TRACKER_API_KEY }
        }
      );
      
      const data = await response.json();
      
      if (data.error) {
        console.error(`  ⚠️  Solana Tracker API error (attempt ${attempt}/${retries}): ${data.error}`);
        if (attempt < retries) {
          console.log(`  ⏳ Waiting 3 seconds before retry...`);
          await delay(3000);
          continue;
        }
        return null;
      }
      
      // Success! Return the data
      return {
        athPrice: data.price.highest.price,
        athMarketCap: data.price.highest.marketcap,
        athTime: new Date(data.price.highest.time * 1000).toISOString(),
        atlPrice: data.price.lowest.price,
        atlMarketCap: data.price.lowest.marketcap,
        atlTime: new Date(data.price.lowest.time * 1000).toISOString(),
        lastUpdated: new Date().toISOString(),
        dataRangeDays: 30
      };
    } catch (error) {
      console.error(`  ⚠️  Error fetching ATH data (attempt ${attempt}/${retries}): ${error.message}`);
      if (attempt < retries) {
        console.log(`  ⏳ Waiting 3 seconds before retry...`);
        await delay(3000);
      }
    }
  }
  
  return null;
}

// Get ATH for a token (from cache or API)
async function getATH(tokenAddress, currentPrice) {
  const athData = loadATHData();
  
  // Check if we already have ATH data for this token
  if (athData[tokenAddress]) {
    const stored = athData[tokenAddress];
    
    // Check if current price is higher than stored ATH (new ATH!)
    if (currentPrice > stored.athPrice * 1.05) { // 5% threshold to avoid noise
      console.log(`  🚀 New ATH detected for ${tokenAddress}! Updating...`);
      const newATH = await fetchATHData(tokenAddress);
      if (newATH) {
        athData[tokenAddress] = newATH;
        saveATHData(athData);
      }
      // Wait after Solana Tracker API call
      await delay(2000);
      return newATH || stored;
    }
    
    // Return cached ATH data
    return stored;
  } else {
    // First time seeing this token, fetch ATH from API
    console.log(`  📊 Fetching ATH data for new token ${tokenAddress}...`);
    const newATH = await fetchATHData(tokenAddress);
    if (newATH) {
      athData[tokenAddress] = newATH;
      saveATHData(athData);
    }
    // Wait after Solana Tracker API call
    await delay(2000);
    return newATH;
  }
}

// Detect volume spike with ALL filters
function detectVolumeSpike(tokenData) {
  const stats1h = tokenData.stats1h;
  
  if (!stats1h) {
    return {
      spikeDetected: false,
      reason: 'No 1h stats available'
    };
  }
  
  // Check if token was being monitored in last scan
  const wasMonitored = wasTokenMonitoredLastScan(tokenData.id);
  const lastDrawdown = getLastDrawdown(tokenData.id);
  const cooldownStatus = isTokenInCooldown(tokenData.id);
  
  // Determine if this is a micro-cap
  const isMicroCap = tokenData.mcap < MIN_MARKET_CAP;
  
  // BREAKOUT DETECTION: Token pumped above 60% threshold
  // This can happen during cooldown OR during normal monitoring
  if (tokenData.drawdownFromATH !== null && tokenData.drawdownFromATH < MIN_DRAWDOWN_PERCENT) {
    // Check if this is a breakout (was previously being monitored or in cooldown)
    if (cooldownStatus || (wasMonitored && lastDrawdown >= MIN_DRAWDOWN_PERCENT)) {
      return {
        spikeDetected: true,
        isBreakout: true,
        isMicroCap: isMicroCap,
        previousDrawdown: cooldownStatus ? cooldownStatus.initialDrawdown : lastDrawdown,
        currentDrawdown: tokenData.drawdownFromATH,
        volumeChange: stats1h.volumeChange,
        priceChange1h: stats1h.priceChange,
        buyVolume: stats1h.buyVolume || 0,
        sellVolume: stats1h.sellVolume || 0,
        numBuys: stats1h.numBuys,
        numSells: stats1h.numSells,
        numTraders: stats1h.numTraders,
        numNetBuyers: stats1h.numNetBuyers
      };
    }
    
    // Token is above 60% but wasn't being monitored - just skip
    return {
      spikeDetected: false,
      reason: `Not a fallen angel (${tokenData.drawdownFromATH.toFixed(2)}% down < ${MIN_DRAWDOWN_PERCENT}%)`
    };
  }
  
  // Token is still below 60% threshold - check cooldown
  if (cooldownStatus) {
    // Still in cooldown, no breakout
    return {
      spikeDetected: false,
      reason: `In cooldown until ${cooldownStatus.until}`
    };
  }
  
  // Filter 1: Drawdown check (must be fallen angel)
  if (tokenData.drawdownFromATH === null || tokenData.drawdownFromATH < MIN_DRAWDOWN_PERCENT) {
    return {
      spikeDetected: false,
      reason: `Not a fallen angel (${tokenData.drawdownFromATH ? tokenData.drawdownFromATH.toFixed(2) + '%' : 'N/A'} down < ${MIN_DRAWDOWN_PERCENT}%)`
    };
  }
  
  // Filter 2: Volume change (different threshold for micro-caps)
  const volumeChange = stats1h.volumeChange;
  
  if (volumeChange === null || volumeChange === undefined) {
    return {
      spikeDetected: false,
      reason: 'No volume change data'
    };
  }
  
  const requiredVolumeChange = isMicroCap ? MIN_VOLUME_CHANGE_PERCENT_MICROCAP : MIN_VOLUME_CHANGE_PERCENT;
  
  if (volumeChange < requiredVolumeChange) {
    return {
      spikeDetected: false,
      reason: `${isMicroCap ? 'Micro-cap ' : ''}Volume change ${volumeChange.toFixed(2)}% < ${requiredVolumeChange}% threshold`
    };
  }
  
  // Filter 3: Buy volume must be greater than sell volume
  const buyVolume = stats1h.buyVolume || 0;
  const sellVolume = stats1h.sellVolume || 0;
  
  if (buyVolume <= sellVolume) {
    return {
      spikeDetected: false,
      reason: `Sell pressure (Buy: $${buyVolume.toLocaleString()} <= Sell: $${sellVolume.toLocaleString()})`
    };
  }
  
  // ALL FILTERS PASSED! Regular volume spike 🚀
  return {
    spikeDetected: true,
    isBreakout: false,
    isMicroCap: isMicroCap,
    volumeChange: volumeChange,
    priceChange1h: stats1h.priceChange,
    buyVolume: buyVolume,
    sellVolume: sellVolume,
    numBuys: stats1h.numBuys,
    numSells: stats1h.numSells,
    numTraders: stats1h.numTraders,
    numNetBuyers: stats1h.numNetBuyers
  };
}

// Check all tokens for spikes and generate alerts
async function generateAlerts(tokenDataArray) {
  console.log('\n🚨 CHECKING FOR VOLUME SPIKES...\n');
  
  const alerts = [];
  
  for (const tokenData of tokenDataArray) {
    const spike = detectVolumeSpike(tokenData);
    
    if (spike.spikeDetected) {
      const alert = {
        timestamp: new Date().toISOString(),
        isBreakout: spike.isBreakout,
        isMicroCap: spike.isMicroCap,
        token: {
          id: tokenData.id,
          name: tokenData.name,
          symbol: tokenData.symbol,
          mcap: tokenData.mcap,
          currentPrice: tokenData.currentPrice,
          drawdownFromATH: tokenData.drawdownFromATH,
          athPrice: tokenData.athPrice,
          holderCount: tokenData.holderCount,
          organicScore: tokenData.organicScore
        },
        spike: {
          volumeChange: spike.volumeChange,
          priceChange1h: spike.priceChange1h,
          buyVolume: spike.buyVolume,
          sellVolume: spike.sellVolume,
          numBuys: spike.numBuys,
          numSells: spike.numSells,
          numTraders: spike.numTraders,
          numNetBuyers: spike.numNetBuyers
        }
      };
      
      if (spike.isBreakout) {
        alert.breakout = {
          previousDrawdown: spike.previousDrawdown,
          currentDrawdown: spike.currentDrawdown
        };
      }
      
      alerts.push(alert);
      
      // Handle cooldown and monitoring state
      if (spike.isBreakout) {
        // Remove from cooldown and monitoring - token broke out
        removeCooldown(tokenData.id);
        removeMonitoredToken(tokenData.id);
        console.log(`🚀 ${tokenData.symbol} BREAKOUT - Removed from monitoring (broke through 60% threshold)\n`);
      } else {
        // Regular volume spike - add to cooldown
        addTokenToCooldown(tokenData.id, tokenData.symbol, tokenData.drawdownFromATH);
      }
      
      // Play sound alert (different sound for breakout)
      await playAlertSound(spike.isBreakout);
      
      // Print alert to console
      if (spike.isBreakout) {
        console.log('🚀🤯🚀 BREAKOUT DETECTED! 🚀🤯🚀');
      } else {
        console.log('🔥🔥🔥 VOLUME SPIKE DETECTED! 🔥🔥🔥');
      }
      
      // Add micro-cap label if applicable
      if (spike.isMicroCap) {
        console.log('⚠️  MICRO-CAP (<$100k)');
      }
      
      console.log(`Token: $${tokenData.symbol} (${tokenData.name})`);
      console.log(`Contract: ${tokenData.id}`);
      console.log('');
      console.log(`Price: $${tokenData.currentPrice.toFixed(8)}`);
      console.log(`Market Cap: $${tokenData.mcap.toLocaleString()}`);
      console.log(`Drawdown from ATH: ${tokenData.drawdownFromATH.toFixed(2)}%`);
      console.log(`👥 Holder Count: ${tokenData.holderCount.toLocaleString()}`);
      console.log(`🪐 Organic Score: ${tokenData.organicScore}`);
      console.log('');
      console.log(`📊 1H Stats:`);
      console.log(`Volume Change: ${spike.volumeChange > 0 ? '+' : ''}${spike.volumeChange.toFixed(2)}%`);
      console.log(`Price Change: ${spike.priceChange1h > 0 ? '+' : ''}${spike.priceChange1h.toFixed(2)}%`);
      console.log(`Buy Volume: $${spike.buyVolume.toLocaleString()}`);
      console.log(`Sell Volume: $${spike.sellVolume.toLocaleString()}`);
      console.log(`Net Buyers: ${spike.numNetBuyers}`);
      console.log(`Traders: ${spike.numTraders}`);
      console.log('');
      console.log('─'.repeat(60));
      console.log('');
    } else {
      console.log(`✓ ${tokenData.symbol}: No spike (${spike.reason})`);
      
      // Update monitoring state for tokens still being monitored (>60% down)
      if (tokenData.drawdownFromATH >= MIN_DRAWDOWN_PERCENT) {
        updateMonitoredToken(tokenData.id, tokenData.symbol, tokenData.drawdownFromATH);
      } else {
        // Token no longer a fallen angel, remove from monitoring
        if (wasTokenMonitoredLastScan(tokenData.id)) {
          removeMonitoredToken(tokenData.id);
        }
      }
    }
  }
  
  if (alerts.length === 0) {
    console.log('\n✅ No volume spikes detected in this cycle.\n');
  } else {
    console.log(`\n🎯 Total alerts: ${alerts.length}\n`);
  }
  
  return alerts;
}

// Save alerts to file
function saveAlerts(alerts) {
  if (alerts.length === 0) return;
  
  try {
    // Load existing alerts
    let allAlerts = [];
    try {
      const data = fs.readFileSync(PATHS.alerts, 'utf8');
      allAlerts = JSON.parse(data);
    } catch (error) {
      // File doesn't exist yet
    }
    
    // Append new alerts
    allAlerts.push(...alerts);
    
    // Save all alerts
    fs.writeFileSync(
      PATHS.alerts,
      JSON.stringify(allAlerts, null, 2),
      'utf8'
    );
    
    console.log(`✓ Alerts saved to ${PATHS.alerts}`);
    
  } catch (error) {
    console.error('Error saving alerts:', error.message);
  }
}

// Load existing history
function loadHistory() {
  try {
    const data = fs.readFileSync(PATHS.tokenHistory, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

// Save data to history file
function saveToHistory(tokenDataArray) {
  try {
    const history = loadHistory();
    const timestamp = new Date().toISOString();
    
    history[timestamp] = tokenDataArray;
    
    fs.writeFileSync(
      PATHS.tokenHistory,
      JSON.stringify(history, null, 2),
      'utf8'
    );
    
    console.log(`✓ Data saved to ${PATHS.tokenHistory} at ${timestamp}`);
    
    fs.writeFileSync(
      PATHS.latestSnapshot,
      JSON.stringify({
        timestamp: timestamp,
        tokens: tokenDataArray
      }, null, 2),
      'utf8'
    );
    
    console.log(`✓ Latest snapshot saved to ${PATHS.latestSnapshot}`);
    
  } catch (error) {
    console.error('Error saving to file:', error.message);
  }
}

async function fetchTokenData(tokenAddress) {
  try {
    const options = {
      method: 'GET',
      headers: { 'x-api-key': JUPITER_API_KEY }
    };

    const response = await fetch(
      `https://api.jup.ag/tokens/v2/search?query=${tokenAddress}`,
      options
    );

    const data = await response.json();
    
    if (!data || data.length === 0) {
      console.log(`No data found for token: ${tokenAddress}`);
      return null;
    }

    const token = data[0];
    
    // Get current price
    const currentPrice = token.usdPrice || 0;
    
    // Get ATH data (with built-in retry and delay)
    const athData = await getATH(tokenAddress, currentPrice);
    
    // Calculate drawdown from ATH
    let drawdownPercent = null;
    if (athData && athData.athPrice > 0) {
      drawdownPercent = ((athData.athPrice - currentPrice) / athData.athPrice) * 100;
    }

    const tokenData = {
      id: token.id,
      name: token.name,
      symbol: token.symbol,
      holderCount: token.holderCount,
      organicScore: token.organicScore,
      mcap: token.mcap,
      currentPrice: currentPrice,
      
      // ATH data
      athPrice: athData ? athData.athPrice : null,
      athMarketCap: athData ? athData.athMarketCap : null,
      drawdownFromATH: drawdownPercent,
      
      stats1h: extractStats(token.stats1h),
      stats6h: extractStats(token.stats6h),
      stats24h: extractStats(token.stats24h),
      fetchedAt: new Date().toISOString()
    };

    return tokenData;

  } catch (error) {
    console.error(`Error fetching token data for ${tokenAddress}: ${error.message}`);
    return null;
  }
}

function extractStats(stats) {
  if (!stats) return null;
  
  return {
    priceChange: stats.priceChange,
    holderChange: stats.holderChange,
    volumeChange: stats.volumeChange,
    buyVolume: stats.buyVolume,
    sellVolume: stats.sellVolume,
    numBuys: stats.numBuys,
    numSells: stats.numSells,
    numTraders: stats.numTraders,
    numOrganicBuyers: stats.numOrganicBuyers,
    numNetBuyers: stats.numNetBuyers
  };
}

async function fetchAllTokens(confirmedTokens, newTokens) {
  const allTokensToFetch = [...confirmedTokens, ...newTokens];
  
  if (allTokensToFetch.length === 0) {
    console.log('⚠️  No tokens to monitor after filtering.');
    return [];
  }
  
  console.log(`📡 Fetching detailed data for ${allTokensToFetch.length} tokens...\n`);
  
  const results = [];
  
  for (let i = 0; i < allTokensToFetch.length; i++) {
    const tokenAddress = allTokensToFetch[i];
    const isNewToken = newTokens.includes(tokenAddress);
    
    console.log(`[${i + 1}/${allTokensToFetch.length}] Fetching ${tokenAddress}...${isNewToken ? ' (NEW - checking drawdown)' : ''}`);
    
    const tokenData = await fetchTokenData(tokenAddress);
    
    if (tokenData) {
      // No longer filter out micro-caps - we now monitor them with stricter rules
      
      // For new tokens, check if they meet the 60% drawdown requirement
      if (isNewToken) {
        if (tokenData.drawdownFromATH !== null && tokenData.drawdownFromATH >= MIN_DRAWDOWN_PERCENT) {
          results.push(tokenData);
          const isMicroCap = tokenData.mcap < MIN_MARKET_CAP;
          console.log(`✓ ${tokenData.symbol} fetched successfully (${tokenData.drawdownFromATH.toFixed(2)}% from ATH${isMicroCap ? ', MICRO-CAP' : ''}) → QUALIFIES`);
        } else {
          console.log(`✓ ${tokenData.symbol} fetched (${tokenData.drawdownFromATH ? tokenData.drawdownFromATH.toFixed(2) + '% from ATH' : 'N/A'}) → DOES NOT QUALIFY (< ${MIN_DRAWDOWN_PERCENT}%)`);
        }
      } else {
        // For existing tokens (including those in cooldown or being monitored)
        results.push(tokenData);
        const isMicroCap = tokenData.mcap < MIN_MARKET_CAP;
        console.log(`✓ ${tokenData.symbol} fetched successfully (${tokenData.drawdownFromATH ? tokenData.drawdownFromATH.toFixed(2) + '% from ATH' : 'ATH data pending'}${isMicroCap ? ', MICRO-CAP' : ''})`);
      }
    }
    
    // Wait between tokens to avoid overwhelming APIs
    if (i < allTokensToFetch.length - 1) {
      console.log(`  ⏳ Waiting 2 seconds before next token...\n`);
      await delay(2000);
    }
  }
  
  console.log(`\nCompleted! Monitoring ${results.length}/${allTokensToFetch.length} tokens`);
  return results;
}

async function runSingleScan() {
  console.log('═'.repeat(60));
  console.log('🤖 MEME COIN VOLUME SPIKE DETECTOR');
  console.log('═'.repeat(60));
  console.log(`Run time: ${new Date().toLocaleString()}\n`);
  
  const watchlist = loadWatchlist();
  
  if (watchlist.length === 0) {
    console.log('No tokens in watchlist. Skipping scan.');
    return;
  }
  
  // Clean up monitoring state and cooldowns - remove tokens not in watchlist
  cleanupMonitoringState(watchlist);
  cleanupCooldowns(watchlist);
  
  // STEP 1: Filter watchlist
  const filteredTokens = await filterWatchlist(watchlist);
  
  // STEP 2: Get tokens from monitoring state (ONLY if they're in watchlist)
  const monitoringState = loadMonitoringState();
  const monitoredTokens = Object.keys(monitoringState.monitoredTokens || {})
    .filter(addr => watchlist.includes(addr)); // Only monitor if in watchlist
  
  // STEP 3: Get tokens in cooldown (ONLY if they're in watchlist)
  const cooldowns = loadCooldowns();
  const tokensInCooldown = Object.keys(cooldowns)
    .filter(addr => watchlist.includes(addr)); // Only check cooldown if in watchlist
  
  // Combine all tokens that need monitoring
  const allTokensToMonitor = [...new Set([
    ...filteredTokens.confirmed,
    ...monitoredTokens,
    ...tokensInCooldown
  ])];
  
  if (allTokensToMonitor.length === 0 && filteredTokens.newTokens.length === 0) {
    console.log('✅ No tokens meet monitoring criteria.');
    return;
  }
  
  // STEP 4: Fetch detailed data
  const allTokenData = await fetchAllTokens(allTokensToMonitor, filteredTokens.newTokens);
  
  if (allTokenData.length === 0) {
    console.log('⚠️  No qualifying tokens after filtering.');
    return;
  }
  
  // STEP 5: Detect spikes and generate alerts
  const alerts = await generateAlerts(allTokenData);
  
  // STEP 6: Save everything
  saveToHistory(allTokenData);
  saveAlerts(alerts);
  
  console.log('═'.repeat(60));
  console.log('✅ Scan completed!');
  console.log('═'.repeat(60));
}

async function runContinuous() {
  console.log('\n');
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│                                                         │');
  console.log('│   ████████╗█████╗ ██╗     ██╗     ███████╗███╗   ██╗    │');
  console.log('│   ██╔════╝██╔══██╗██║     ██║     ██╔════╝████╗  ██║    │');
  console.log('│   █████╗  ███████║██║     ██║     █████╗  ██╔██╗ ██║    │');
  console.log('│   ██╔══╝  ██╔══██║██║     ██║     ██╔══╝  ██║╚██╗██║    │');
  console.log('│   ██║     ██║  ██║███████╗███████╗███████╗██║ ╚████║    │');
  console.log('│   ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚═╝  ╚═══╝    │');
  console.log('│                                                         │');
  console.log('│   █████╗ ███╗   ██╗ ██████╗ ███████╗██╗     ███████╗    │');
  console.log('│  ██╔══██╗████╗  ██║██╔════╝ ██╔════╝██║     ██╔════╝    │');
  console.log('│  ███████║██╔██╗ ██║██║  ███╗█████╗  ██║     ███████╗    │');
  console.log('│  ██╔══██║██║╚██╗██║██║   ██║██╔══╝  ██║     ╚════██║    │');
  console.log('│  ██║  ██║██║ ╚████║╚██████╔╝███████╗███████╗███████║    │');
  console.log('│  ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝    │');
  console.log('│                                                         │');
  console.log('│              🔥 LIVE MONITORING 🔥                      │');
  console.log('│                                                         │');
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log(`\n⏰ Scan interval: Every ${SCAN_INTERVAL_MINUTES} minutes`);
  console.log(`📊 Volume spike detection:`);
  console.log(`   • Regular tokens (≥$100k): ${MIN_VOLUME_CHANGE_PERCENT}% volume increase`);
  console.log(`   • Micro-caps (<$100k): ${MIN_VOLUME_CHANGE_PERCENT_MICROCAP}% volume increase`);
  console.log(`📉 Targeting tokens down > ${MIN_DRAWDOWN_PERCENT}% from ATH`);
  console.log(`📈 Requires: Buy Volume > Sell Volume`);
  console.log(`🕐 Cooldown: Until next :00 or :30 milestone`);
  console.log(`🚀 Breakout: Token pumps above ${MIN_DRAWDOWN_PERCENT}% threshold (during cooldown OR monitoring)`);
  console.log(`\n🔊 Volume spike alert: ${PATHS.soundVolume}`);
  console.log(`🔊 Breakout alert: ${PATHS.soundBreakout}`);
  console.log(`\n💡 Press Ctrl+C to stop monitoring\n`);
  console.log('─'.repeat(60));
  
  // Run first scan immediately
  await runSingleScan();
  
  // Then run every SCAN_INTERVAL_MINUTES
  const intervalMs = SCAN_INTERVAL_MINUTES * 60 * 1000;
  
  setInterval(async () => {
    console.log(`\n⏰ Starting next scan... (${new Date().toLocaleString()})\n`);
    await runSingleScan();
  }, intervalMs);
  
  // Show countdown timer
  let secondsUntilNext = SCAN_INTERVAL_MINUTES * 60;
  setInterval(() => {
    secondsUntilNext--;
    if (secondsUntilNext <= 0) {
      secondsUntilNext = SCAN_INTERVAL_MINUTES * 60;
    }
    
    const minutes = Math.floor(secondsUntilNext / 60);
    const seconds = secondsUntilNext % 60;
    process.stdout.write(`\r⏳ Next scan in: ${minutes}:${seconds.toString().padStart(2, '0')}   `);
  }, 1000);
}

// Run in continuous mode
runContinuous();
