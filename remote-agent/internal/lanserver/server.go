package lanserver

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/json"
	"net"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/proto"
)

// Límites. Variables (no const) para poder ajustarlos en pruebas.
var (
	AuthTimeout      = 8 * time.Second  // handshake TLS + prueba del visor
	IdleTimeout      = 60 * time.Second // sin ningún mensaje del visor
	WriteTimeout     = 10 * time.Second
	MaxAuthFailures  = 5
	FailWindow       = 15 * time.Minute
	BlockDuration    = 15 * time.Minute
	MaxPendingGlobal = 8
	MaxPendingPerIP  = 3
	MaxViewerMsgPerS = 250
	MaxBadMessages   = 50
)

// Server escucha TLS 1.3 y atiende UN visor a la vez. Mientras el visor no
// demuestre el secreto del emparejamiento, el servidor no envía ni un byte
// (ni banner, ni errores, ni nombre, ni versión): cierra en silencio.
type Server struct {
	cfg     Config
	id      *Identity
	ctrl    *core.Controller
	tlsConf *tls.Config
	fails   *failTracker
	pending *pendingLimiter
	busy    atomic.Bool
	now     func() time.Time

	mu sync.Mutex
	tr *core.Transport
}

func New(cfg Config, id *Identity, ctrl *core.Controller) *Server {
	now := time.Now
	return &Server{
		cfg: cfg, id: id, ctrl: ctrl, now: now,
		tlsConf: &tls.Config{
			Certificates: []tls.Certificate{id.Cert},
			MinVersion:   tls.VersionTLS13,
			MaxVersion:   tls.VersionTLS13,
		},
		fails:   newFailTracker(MaxAuthFailures, FailWindow, BlockDuration, now),
		pending: newPendingLimiter(MaxPendingGlobal, MaxPendingPerIP),
	}
}

// peekConn deja mirar el primer byte sin consumirlo (para descartar conexiones que no son TLS).
type peekConn struct {
	net.Conn
	r *bufio.Reader
}

func (p *peekConn) Read(b []byte) (int, error) { return p.r.Read(b) }

func addrOf(c net.Conn) (netip.Addr, bool) {
	ap, err := netip.ParseAddrPort(c.RemoteAddr().String())
	if err != nil {
		return netip.Addr{}, false
	}
	return ap.Addr().Unmap(), true
}

// Serve acepta conexiones hasta que ctx termine o ln se cierre.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	go func() { <-ctx.Done(); ln.Close() }()
	for {
		c, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				continue
			}
			return err
		}
		go s.handle(ctx, c)
	}
}

func (s *Server) handle(parent context.Context, raw net.Conn) {
	defer raw.Close()
	ip, ok := addrOf(raw)
	if !ok || !s.cfg.IPAllowed(ip) || s.fails.Blocked(ip) {
		return // silencio
	}
	if !s.pending.Acquire(ip) {
		return
	}
	released := false
	release := func() {
		if !released {
			released = true
			s.pending.Release(ip)
		}
	}
	defer release()

	raw.SetDeadline(s.now().Add(AuthTimeout))
	pc := &peekConn{Conn: raw, r: bufio.NewReader(raw)}
	if b, err := pc.r.Peek(1); err != nil || b[0] != 0x16 { // 0x16 = inicio de handshake TLS
		return // no es TLS: ni una respuesta
	}
	tc := tls.Server(pc, s.tlsConf)
	if err := tc.Handshake(); err != nil {
		return
	}
	st := tc.ConnectionState()
	ekm, err := st.ExportKeyingMaterial(proto.AuthExporterLabel, nil, 32)
	if err != nil {
		return
	}
	typ, data, err := proto.ReadFrame(tc, proto.MaxPreAuthFrame)
	var ar proto.AuthReply
	if err != nil || typ != proto.FrameText || json.Unmarshal(data, &ar) != nil ||
		ar.T != "auth" || !proto.VerifyAuthMAC(s.id.Secret, proto.RoleVisor, ekm, ar.MAC) {
		s.fails.Fail(ip)
		if s.fails.Blocked(ip) {
			core.Logf("Demasiados intentos fallidos desde %s: bloqueada %d min.", ip, int(BlockDuration.Minutes()))
		} else {
			core.Logf("Intento de conexión sin emparejamiento válido desde %s (rechazado).", ip)
		}
		return
	}
	s.fails.Ok(ip)
	release()
	tc.SetDeadline(time.Time{})
	s.session(parent, tc, ekm, proto.SanitizeViewer(ar.Viewer))
}

func (s *Server) session(parent context.Context, tc *tls.Conn, ekm []byte, viewer string) {
	var wmu sync.Mutex
	write := func(typ byte, b []byte) error {
		wmu.Lock()
		defer wmu.Unlock()
		tc.SetWriteDeadline(time.Now().Add(WriteTimeout))
		return proto.WriteFrame(tc, typ, b)
	}
	tr := core.Transport{
		WriteText:   func(b []byte) error { return write(proto.FrameText, b) },
		WriteBinary: func(b []byte) error { return write(proto.FrameBinary, b) },
	}
	// Ya autenticado: ahora sí se puede responder (incluida la prueba del servidor).
	if err := tr.WriteText(proto.AuthOkMsg(proto.AuthMAC(s.id.Secret, proto.RoleServidor, ekm), s.cfg.Name)); err != nil {
		return
	}
	if !s.busy.CompareAndSwap(false, true) {
		tr.WriteText(proto.ErrorMsg("ocupado"))
		return
	}
	defer s.busy.Store(false)

	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	s.mu.Lock()
	s.tr = &tr
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.tr = nil
		s.mu.Unlock()
	}()

	s.ctrl.SendInfo(tr)
	tr.WriteText([]byte(`{"t":"waiting_consent"}`))
	done := s.ctrl.Start(ctx, tr, viewer)
	closed := make(chan struct{})
	go func() {
		select {
		case <-done:
		case <-ctx.Done():
		}
		tc.Close() // sesión terminada (rechazo, corte local o error): se cierra la conexión
		close(closed)
	}()
	defer func() {
		cancel()
		s.ctrl.End()
		tc.Close()
		<-closed
	}()

	winStart, n, bad := time.Now(), 0, 0
	for {
		tc.SetReadDeadline(time.Now().Add(IdleTimeout))
		typ, data, err := proto.ReadFrame(tc, proto.MaxControlFrame)
		if err != nil || typ != proto.FrameText {
			return
		}
		if time.Since(winStart) >= time.Second {
			winStart, n = time.Now(), 0
		}
		if n++; n > MaxViewerMsgPerS {
			continue // exceso: se descarta
		}
		m, err := proto.ParseViewerMsg(data)
		if err != nil {
			if bad++; bad > MaxBadMessages {
				return
			}
			continue
		}
		if m.T != "ping" {
			s.ctrl.HandleInput(m)
		}
	}
}

// LocalCut: corte local (Ctrl+Shift+F12). La conexión se cierra cuando termina la sesión.
func (s *Server) LocalCut() {
	s.mu.Lock()
	tr := s.tr
	s.mu.Unlock()
	s.ctrl.LocalCut(func() {
		if tr != nil {
			tr.WriteText(proto.ConsentMsg(false, s.cfg.ViewOnly))
		}
	})
}

// Shutdown: al cerrar la ventana.
func (s *Server) Shutdown() { s.LocalCut() }

// LocalIPs lista las IPv4 privadas de este equipo (para mostrarlas en consola).
func LocalIPs() []string {
	var out []string
	ifs, _ := net.Interfaces()
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLinkLocalUnicast() {
				out = append(out, ipn.IP.String())
			}
		}
	}
	return out
}
