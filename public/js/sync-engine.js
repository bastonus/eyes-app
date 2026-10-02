/**
 * DragonSyncClient
 * NTP-like high-precision clock synchronization over Socket.IO.
 * Keeps local and server clocks synchronized to within < 10ms.
 */
class DragonSyncClient {
  constructor(socket) {
    this.socket = socket;
    this.offset = 0; // Estimated serverTime - Date.now()
    this.rtt = 0;
    this.samples = [];
    this.maxSamples = 12;
    this.isSynced = false;
    this.syncIntervalId = null;

    this._setupListeners();
  }

  _setupListeners() {
    this.socket.on('connect', () => {
      // Immediate rapid burst on connection / reconnection
      this.triggerBurstSync();
    });

    this.socket.on('sync:pong', ({ clientTime, serverTime }) => {
      const now = performance.now();
      const rtt = now - clientTime;

      if (rtt < 0 || isNaN(rtt)) return;

      // Estimated server timestamp at the exact moment this pong was received:
      // serverTime + rtt / 2
      const estimatedNow = Date.now();
      const sampleOffset = (serverTime + (rtt / 2)) - estimatedNow;

      this.samples.push({ offset: sampleOffset, rtt });
      if (this.samples.length > this.maxSamples) {
        this.samples.shift();
      }

      // Filter out high jitter samples (keep best 50% with lowest RTT)
      const sortedByRtt = [...this.samples].sort((a, b) => a.rtt - b.rtt);
      const bestSamples = sortedByRtt.slice(0, Math.max(1, Math.ceil(sortedByRtt.length / 2)));

      // Calculate median offset from the lowest RTT samples
      bestSamples.sort((a, b) => a.offset - b.offset);
      const medianSample = bestSamples[Math.floor(bestSamples.length / 2)];

      this.offset = medianSample.offset;
      this.rtt = sortedByRtt[0].rtt;
      this.isSynced = true;
    });
  }

  triggerBurstSync() {
    // Send 4 rapid pings to immediately establish clock lock within 300ms
    this.ping();
    setTimeout(() => this.ping(), 70);
    setTimeout(() => this.ping(), 150);
    setTimeout(() => this.ping(), 250);
  }

  seedOffset(serverTime) {
    if (!this.isSynced && typeof serverTime === 'number') {
      this.offset = serverTime - Date.now();
      this.isSynced = true;
    }
  }

  start(intervalMs = 1500) {
    this.triggerBurstSync();

    if (this.syncIntervalId) clearInterval(this.syncIntervalId);
    this.syncIntervalId = setInterval(() => this.ping(), intervalMs);
  }

  stop() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  ping() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('sync:ping', performance.now());
    }
  }

  /**
   * Returns current high-precision estimated server timestamp in milliseconds.
   */
  now() {
    return Date.now() + this.offset;
  }

  /**
   * Returns current round trip time in ms.
   */
  getRTT() {
    return Math.round(this.rtt);
  }

  /**
   * Returns current offset in ms.
   */
  getOffset() {
    return Math.round(this.offset);
  }
}

window.DragonSyncClient = DragonSyncClient;
