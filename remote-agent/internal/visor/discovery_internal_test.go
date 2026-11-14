package visor

import (
	"net/netip"
	"testing"
	"time"

	"placer/remote-agent/internal/proto"
)

func TestDiscoveryExpiresAfter10s(t *testing.T) {
	now := time.Unix(100, 0)
	d := NewDiscovery()
	d.now = func() time.Time { return now }
	d.Observe(netip.MustParseAddr("192.168.1.7"), proto.Announce{Name: "PC", Port: 5911})
	now = now.Add(9 * time.Second)
	if len(d.List()) != 1 {
		t.Fatal("a los 9 s sigue en línea")
	}
	now = now.Add(2 * time.Second)
	if len(d.List()) != 0 {
		t.Fatal("a los 11 s debe desaparecer")
	}
	d.Observe(netip.MustParseAddr("192.168.1.7"), proto.Announce{Name: "PC", Port: 5911})
	if len(d.List()) != 1 {
		t.Fatal("al volver a anunciar reaparece")
	}
}
