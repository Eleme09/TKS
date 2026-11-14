package visor

import (
	"context"
	"net"
	"net/netip"
	"sort"
	"sync"
	"time"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/proto"
)

// PeerTTL: un equipo desaparece de la lista si no anuncia en este tiempo.
const PeerTTL = 10 * time.Second

type peer struct {
	Name     string
	IP       netip.Addr
	Port     int
	LastSeen time.Time
}

// Peer es lo que ve la página.
type Peer struct {
	ID    string `json:"id"` // ip:puerto
	Name  string `json:"name"`
	IP    string `json:"ip"`
	Port  int    `json:"port"`
	AgeMs int64  `json:"ageMs"`
}

type Discovery struct {
	mu    sync.Mutex
	peers map[string]peer
	now   func() time.Time
}

func NewDiscovery() *Discovery { return &Discovery{peers: map[string]peer{}, now: time.Now} }

// IsLANAddr: solo direcciones de red local (privadas, enlace local o loopback).
func IsLANAddr(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast()
}

// Observe registra un anuncio recibido de ip (el origen real del paquete UDP).
func (d *Discovery) Observe(ip netip.Addr, a proto.Announce) {
	ip = ip.Unmap()
	if !IsLANAddr(ip) {
		return
	}
	key := netip.AddrPortFrom(ip, uint16(a.Port)).String()
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.peers[key]; !ok && len(d.peers) >= 256 {
		return
	}
	d.peers[key] = peer{Name: a.Name, IP: ip, Port: a.Port, LastSeen: d.now()}
}

// List devuelve los equipos vistos en los últimos PeerTTL, ordenados por nombre.
func (d *Discovery) List() []Peer {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	out := []Peer{}
	for k, p := range d.peers {
		age := now.Sub(p.LastSeen)
		if age > PeerTTL {
			delete(d.peers, k)
			continue
		}
		out = append(out, Peer{ID: k, Name: p.Name, IP: p.IP.String(), Port: p.Port, AgeMs: age.Milliseconds()})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// Listen escucha los anuncios UDP hasta que ctx termine.
func (d *Discovery) Listen(ctx context.Context, port int) error {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{Port: port})
	if err != nil {
		return err
	}
	go func() { <-ctx.Done(); conn.Close() }()
	buf := make([]byte, 1024)
	for {
		n, from, err := conn.ReadFromUDPAddrPort(buf)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			core.Logf("Error escuchando anuncios: %v", err)
			return err
		}
		if a, err := proto.ParseAnnounce(buf[:n]); err == nil {
			d.Observe(from.Addr(), a)
		}
	}
}
