package lanserver

import (
	"net/netip"
	"sync"
	"time"
)

// failTracker bloquea una IP tras demasiados intentos de autenticación fallidos.
type failTracker struct {
	mu       sync.Mutex
	max      int
	window   time.Duration
	blockFor time.Duration
	now      func() time.Time
	ips      map[netip.Addr]*failEntry
}

type failEntry struct {
	count        int
	windowStart  time.Time
	blockedUntil time.Time
}

func newFailTracker(max int, window, blockFor time.Duration, now func() time.Time) *failTracker {
	return &failTracker{max: max, window: window, blockFor: blockFor, now: now, ips: map[netip.Addr]*failEntry{}}
}

func (f *failTracker) Blocked(ip netip.Addr) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	e := f.ips[ip]
	return e != nil && f.now().Before(e.blockedUntil)
}

func (f *failTracker) Fail(ip netip.Addr) {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := f.now()
	e := f.ips[ip]
	if e == nil {
		if len(f.ips) > 4096 { // no crecer sin límite ante un barrido de IPs
			for k, v := range f.ips {
				if now.After(v.blockedUntil) && now.Sub(v.windowStart) > f.window {
					delete(f.ips, k)
				}
			}
		}
		e = &failEntry{windowStart: now}
		f.ips[ip] = e
	}
	if now.Sub(e.windowStart) > f.window {
		e.count, e.windowStart = 0, now
	}
	e.count++
	if e.count >= f.max {
		e.blockedUntil = now.Add(f.blockFor)
		e.count = 0
	}
}

// Ok: una autenticación correcta limpia el historial de esa IP.
func (f *failTracker) Ok(ip netip.Addr) {
	f.mu.Lock()
	delete(f.ips, ip)
	f.mu.Unlock()
}

// pendingLimiter limita las conexiones aún sin autenticar (global y por IP).
type pendingLimiter struct {
	mu        sync.Mutex
	maxGlobal int
	maxPerIP  int
	total     int
	byIP      map[netip.Addr]int
}

func newPendingLimiter(g, p int) *pendingLimiter {
	return &pendingLimiter{maxGlobal: g, maxPerIP: p, byIP: map[netip.Addr]int{}}
}

func (l *pendingLimiter) Acquire(ip netip.Addr) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.total >= l.maxGlobal || l.byIP[ip] >= l.maxPerIP {
		return false
	}
	l.total++
	l.byIP[ip]++
	return true
}

func (l *pendingLimiter) Release(ip netip.Addr) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.total--
	if l.byIP[ip]--; l.byIP[ip] <= 0 {
		delete(l.byIP, ip)
	}
}
