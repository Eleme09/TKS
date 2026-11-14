package lanserver

import (
	"net/netip"
	"testing"
	"time"
)

func TestFailTrackerBlocksAndExpires(t *testing.T) {
	now := time.Unix(1000, 0)
	f := newFailTracker(5, 15*time.Minute, 15*time.Minute, func() time.Time { return now })
	ip := netip.MustParseAddr("192.168.1.9")
	other := netip.MustParseAddr("192.168.1.10")
	for i := 0; i < 4; i++ {
		f.Fail(ip)
	}
	if f.Blocked(ip) {
		t.Fatal("4 fallos aún no bloquean")
	}
	f.Fail(ip)
	if !f.Blocked(ip) {
		t.Fatal("5 fallos deben bloquear")
	}
	if f.Blocked(other) {
		t.Fatal("otra IP no se bloquea")
	}
	now = now.Add(14 * time.Minute)
	if !f.Blocked(ip) {
		t.Fatal("sigue bloqueada a los 14 min")
	}
	now = now.Add(2 * time.Minute)
	if f.Blocked(ip) {
		t.Fatal("a los 16 min se desbloquea")
	}
}

func TestFailWindowResets(t *testing.T) {
	now := time.Unix(0, 0)
	f := newFailTracker(3, time.Minute, time.Hour, func() time.Time { return now })
	ip := netip.MustParseAddr("10.0.0.1")
	f.Fail(ip)
	f.Fail(ip)
	now = now.Add(2 * time.Minute) // fuera de la ventana
	f.Fail(ip)
	if f.Blocked(ip) {
		t.Fatal("los fallos viejos no cuentan")
	}
}

func TestPendingLimiter(t *testing.T) {
	l := newPendingLimiter(3, 2)
	a, b := netip.MustParseAddr("10.0.0.1"), netip.MustParseAddr("10.0.0.2")
	if !l.Acquire(a) || !l.Acquire(a) || l.Acquire(a) {
		t.Fatal("máximo 2 por IP")
	}
	if !l.Acquire(b) || l.Acquire(b) {
		t.Fatal("máximo 3 en total")
	}
	l.Release(a)
	if !l.Acquire(b) {
		t.Fatal("al liberar hay cupo")
	}
}
