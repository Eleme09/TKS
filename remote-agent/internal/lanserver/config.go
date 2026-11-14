package lanserver

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"strings"

	"placer/remote-agent/internal/proto"
)

// Config se lee de config.json junto al .exe. No hay contraseña: la
// autenticación usa el emparejamiento (pairing.json).
type Config struct {
	Port             int      `json:"port"`
	Name             string   `json:"name"`
	ViewOnly         bool     `json:"viewOnly"`
	Announce         *bool    `json:"announce"` // omitido = true
	AllowedViewerIPs []string `json:"allowedViewerIPs"`

	allowed []netip.Prefix
}

func (c *Config) AnnounceEnabled() bool { return c.Announce == nil || *c.Announce }

// ParseConfig valida config.json (también acepta que falte: usa valores por defecto).
func ParseConfig(data []byte, hostname string) (Config, error) {
	var c Config
	if len(strings.TrimSpace(string(data))) > 0 {
		if err := json.Unmarshal(data, &c); err != nil {
			return c, fmt.Errorf("config.json inválido: %w", err)
		}
	}
	if c.Port == 0 {
		c.Port = proto.DefaultPort
	}
	if c.Port < 1 || c.Port > 65535 {
		return c, errors.New("port inválido (1-65535)")
	}
	c.Name = strings.TrimSpace(c.Name)
	if c.Name == "" {
		c.Name = hostname
	}
	if c.Name == "" {
		c.Name = "PC"
	}
	for _, s := range c.AllowedViewerIPs {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		pf, err := netip.ParsePrefix(s)
		if err != nil {
			ip, err2 := netip.ParseAddr(s)
			if err2 != nil {
				return c, fmt.Errorf("allowedViewerIPs: %q no es una IP ni un rango (ej. 192.168.1.20 o 192.168.1.0/24)", s)
			}
			pf = netip.PrefixFrom(ip, ip.BitLen())
		}
		c.allowed = append(c.allowed, pf)
	}
	return c, nil
}

// IPAllowed: sin lista, cualquiera de la red puede intentar (igual necesita el emparejamiento).
func (c *Config) IPAllowed(ip netip.Addr) bool {
	if len(c.allowed) == 0 {
		return true
	}
	ip = ip.Unmap()
	for _, p := range c.allowed {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}
