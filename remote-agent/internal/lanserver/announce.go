package lanserver

import (
	"context"
	"net"
	"time"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/proto"
)

// broadcastTargets: 255.255.255.255 y el broadcast dirigido de cada interfaz IPv4.
func broadcastTargets(port int) []*net.UDPAddr {
	out := []*net.UDPAddr{{IP: net.IPv4bcast, Port: port}}
	ifs, _ := net.Interfaces()
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 || ifc.Flags&net.FlagBroadcast == 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			if ip4 == nil || len(ipn.Mask) != 4 && len(ipn.Mask) != 16 {
				continue
			}
			mask := ipn.Mask
			if len(mask) == 16 {
				mask = mask[12:]
			}
			b := make(net.IP, 4)
			for i := range b {
				b[i] = ip4[i] | ^mask[i]
			}
			out = append(out, &net.UDPAddr{IP: b, Port: port})
		}
	}
	return out
}

// RunAnnouncer manda {name, port} por UDP broadcast cada 3 s hasta que ctx termine.
// targets vacío → broadcast real de la red (se puede inyectar uno para pruebas).
func RunAnnouncer(ctx context.Context, name string, tlsPort int, targets []*net.UDPAddr) {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{})
	if err != nil {
		core.Logf("No se pudo abrir el anuncio en la red: %v (se puede conectar escribiendo la IP).", err)
		return
	}
	defer conn.Close()
	msg := proto.MarshalAnnounce(proto.Announce{Name: name, Port: tlsPort})
	send := func() {
		ts := targets
		if len(ts) == 0 {
			ts = broadcastTargets(proto.AnnouncePort)
		}
		for _, t := range ts {
			conn.WriteToUDP(msg, t)
		}
	}
	send()
	tk := time.NewTicker(proto.AnnounceInterval * time.Second)
	defer tk.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tk.C:
			send()
		}
	}
}
