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
    this.maxSamples = 8;
    this.isSynced = false;
    this.syncIntervalId = null;

    this._setupListeners();
  }

  _setupListeners() {
    this.socket.on('sync:pong', ({ clientTime, serverTime }) => {
      const now = performance.now();
      const rtt = now - clientTime;
      // Estimated server timestamp at the exact moment this pong was received:
      // serverTime + rtt / 2
      const estimatedNow = Date.now();
      const sampleOffset = (serverTime + (rtt / 2)) - estimatedNow;

      this.samples.push({ offset: sampleOffset, rtt });
      if (this.samples.length > this.maxSamples) {
        this.samples.shift();
      }

      // Pick the sample with the lowest RTT (least network delay jitter)
      let bestSample = this.samples[0];
      for (const s of this.samples) {
        if (s.rtt < bestSample.rtt) {
          bestSample = s;
        }
      }

      this.offset = bestSample.offset;
      this.rtt = bestSample.rtt;
      this.isSynced = true;
    });
  }

  start(intervalMs = 3000) {
    this.ping();
    // Burst initial pings to establish quick lock
    setTimeout(() => this.ping(), 500);
    setTimeout(() => this.ping(), 1200);

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
