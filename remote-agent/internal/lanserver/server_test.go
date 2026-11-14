package lanserver_test

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"image"
	"image/color"
	"io"
	"net"
	"net/netip"
	"os"
	"testing"
	"time"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/lanserver"
	"placer/remote-agent/internal/proto"
	"placer/remote-agent/internal/visor"
)

func init() {
	lanserver.AuthTimeout = 600 * time.Millisecond
}

func fakeCtrl(consent bool) *core.Controller {
	c := core.NewController(core.CaptureOptions{Interval: 50 * time.Millisecond}, false)
	c.Consent = func(ctx context.Context, viewer string) bool { return consent }
	c.Capture = func() (*image.RGBA, error) {
		img := image.NewRGBA(image.Rect(0, 0, 64, 48))
		for y := 0; y < 48; y++ {
			for x := 0; x < 64; x++ {
				img.Set(x, y, color.RGBA{uint8(x * 4), uint8(y * 5), 9, 255})
			}
		}
		return img, nil
	}
	c.Size = func() (int, int, error) { return 64, 48, nil }
	return c
}

type env struct {
	srv  *lanserver.Server
	id   *lanserver.Identity
	addr netip.AddrPort
	pair proto.Pairing
}

func start(t *testing.T, cfgJSON string, consent bool) *env {
	t.Helper()
	cfg, err := lanserver.ParseConfig([]byte(cfgJSON), "pc-test")
	if err != nil {
		t.Fatal(err)
	}
	id, err := lanserver.LoadOrCreateIdentity(t.TempDir(), cfg.Name, 5911)
	if err != nil {
		t.Fatal(err)
	}
	srv := lanserver.New(cfg, id, fakeCtrl(consent))
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go srv.Serve(ctx, ln)
	return &env{srv: srv, id: id, addr: ln.Addr().(*net.TCPAddr).AddrPort(), pair: id.Pairing}
}

func readFrames(t *testing.T, c net.Conn, want func(typ byte, data []byte) bool) {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		typ, data, err := proto.ReadFrame(c, proto.MaxMediaFrame)
		if err != nil {
			t.Fatalf("no llegó lo esperado: %v", err)
		}
		if want(typ, data) {
			return
		}
	}
}

func TestPairedViewerGetsSession(t *testing.T) {
	e := start(t, `{"name":"PC Recepción"}`, true)
	r, err := visor.Dial(context.Background(), e.addr, e.pair, "Visor prueba")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Conn.Close()
	if r.Name != "PC Recepción" {
		t.Errorf("nombre: %q", r.Name)
	}
	var gotConsent, gotJPEG bool
	readFrames(t, r.Conn, func(typ byte, d []byte) bool {
		if typ == proto.FrameText {
			var m map[string]any
			json.Unmarshal(d, &m)
			if m["t"] == "consent" && m["ok"] == true {
				gotConsent = true
			}
		} else if len(d) > 2 && d[0] == 0xFF && d[1] == 0xD8 {
			gotJPEG = true
		}
		return gotConsent && gotJPEG
	})
	// mensajes válidos e inválidos no rompen la sesión
	proto.WriteFrame(r.Conn, proto.FrameText, []byte(`{"t":"mouse","a":"move","x":0.5,"y":0.5}`))
	proto.WriteFrame(r.Conn, proto.FrameText, []byte(`{"t":"mouse","a":"move","x":7,"y":0.5}`))
	proto.WriteFrame(r.Conn, proto.FrameText, []byte(`{"t":"ping"}`))
}

func TestConsentRefusedClosesConnection(t *testing.T) {
	e := start(t, `{}`, false)
	r, err := visor.Dial(context.Background(), e.addr, e.pair, "v")
	if err != nil {
		t.Fatal(err)
	}
	defer r.Conn.Close()
	var refused bool
	r.Conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		typ, d, err := proto.ReadFrame(r.Conn, proto.MaxMediaFrame)
		if err != nil {
			break
		}
		var m map[string]any
		if typ == proto.FrameText && json.Unmarshal(d, &m) == nil && m["t"] == "consent" && m["ok"] == false {
			refused = true
		}
	}
	if !refused {
		t.Error("debía llegar consent ok=false y luego cerrarse")
	}
}

func TestWrongSecretRejected(t *testing.T) {
	e := start(t, `{}`, true)
	bad := e.pair
	bad.Secret = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
	if _, err := visor.Dial(context.Background(), e.addr, bad, "v"); err != visor.ErrNotAuthed {
		t.Fatalf("esperaba ErrNotAuthed, fue %v", err)
	}
}

func TestWrongFingerprintRejectedByViewer(t *testing.T) {
	e := start(t, `{}`, true)
	other := start(t, `{}`, true) // otro servidor = otro certificado
	bad := e.pair
	bad.Fingerprint = other.pair.Fingerprint
	if _, err := visor.Dial(context.Background(), e.addr, bad, "v"); err != visor.ErrPinMismatch {
		t.Fatalf("esperaba ErrPinMismatch, fue %v", err)
	}
}

// Un servidor impostor (mismo secreto robado pero otro certificado) tampoco pasa el pinning.
func TestImpostorServerWithOwnCertRejected(t *testing.T) {
	real := start(t, `{}`, true)
	imp := start(t, `{}`, true)
	p := imp.pair
	p.Fingerprint = real.pair.Fingerprint // el visor espera el cert del real
	if _, err := visor.Dial(context.Background(), imp.addr, p, "v"); err != visor.ErrPinMismatch {
		t.Fatalf("esperaba ErrPinMismatch, fue %v", err)
	}
}

func TestPlainTCPGetsNothing(t *testing.T) {
	e := start(t, `{}`, true)
	c, err := net.Dial("tcp", e.addr.String())
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.Write([]byte("GET / HTTP/1.1\r\nHost: x\r\n\r\n"))
	c.SetReadDeadline(time.Now().Add(3 * time.Second))
	b, err := io.ReadAll(c)
	if len(b) != 0 {
		t.Fatalf("una conexión sin TLS recibió %d bytes: %q", len(b), b)
	}
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		t.Fatal("debía cerrarse, no quedarse esperando")
	}
}

func rawTLS(t *testing.T, addr string) *tls.Conn {
	t.Helper()
	c, err := tls.Dial("tcp", addr, &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS13})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestClientWithoutPairingGetsNoData(t *testing.T) {
	e := start(t, `{}`, true)
	// (a) habla TLS pero no dice nada
	c := rawTLS(t, e.addr.String())
	c.SetReadDeadline(time.Now().Add(3 * time.Second))
	b, _ := io.ReadAll(c)
	c.Close()
	if len(b) != 0 {
		t.Fatalf("cliente mudo recibió %d bytes", len(b))
	}
	// (b) manda basura / prueba falsa / mensaje con otro formato
	for _, payload := range [][]byte{
		[]byte("hola"),
		proto.ViewerAuthMsg("00", "x"),
		[]byte(`{"t":"mouse","a":"move","x":0.1,"y":0.1}`),
	} {
		c := rawTLS(t, e.addr.String())
		proto.WriteFrame(c, proto.FrameText, payload)
		c.SetReadDeadline(time.Now().Add(3 * time.Second))
		b, _ := io.ReadAll(c)
		c.Close()
		if len(b) != 0 {
			t.Fatalf("cliente sin pairing recibió %d bytes: %q", len(b), b)
		}
	}
}

func TestBruteForceBlocksIP(t *testing.T) {
	e := start(t, `{}`, true)
	bad := e.pair
	bad.Secret = "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100"
	for i := 0; i < lanserver.MaxAuthFailures; i++ {
		if _, err := visor.Dial(context.Background(), e.addr, bad, "v"); err != visor.ErrNotAuthed {
			t.Fatalf("intento %d: %v", i, err)
		}
	}
	// Ahora la IP está bloqueada: ni siquiera con el secreto CORRECTO.
	r, err := visor.Dial(context.Background(), e.addr, e.pair, "v")
	if err == nil {
		r.Conn.Close()
		t.Fatal("la IP bloqueada no debería poder conectar")
	}
}

func TestPendingConnectionLimitPerIP(t *testing.T) {
	e := start(t, `{}`, true)
	var held []*tls.Conn
	for i := 0; i < lanserver.MaxPendingPerIP; i++ {
		held = append(held, rawTLS(t, e.addr.String()))
	}
	defer func() {
		for _, c := range held {
			c.Close()
		}
	}()
	time.Sleep(100 * time.Millisecond)
	// la siguiente se corta de inmediato (antes del handshake TLS)
	c, err := tls.DialWithDialer(&net.Dialer{Timeout: time.Second}, "tcp", e.addr.String(),
		&tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS13})
	if err == nil {
		c.Close()
		t.Fatal("el límite de conexiones sin autenticar no se aplicó")
	}
}

func TestOnlyOneSessionAtATime(t *testing.T) {
	e := start(t, `{}`, true)
	r1, err := visor.Dial(context.Background(), e.addr, e.pair, "uno")
	if err != nil {
		t.Fatal(err)
	}
	defer r1.Conn.Close()
	readFrames(t, r1.Conn, func(typ byte, d []byte) bool { return typ == proto.FrameBinary })
	r2, err := visor.Dial(context.Background(), e.addr, e.pair, "dos")
	if err != nil {
		t.Fatal(err)
	}
	defer r2.Conn.Close()
	var busy bool
	r2.Conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, d, err := proto.ReadFrame(r2.Conn, proto.MaxMediaFrame)
		if err != nil {
			break
		}
		var m map[string]string
		if json.Unmarshal(d, &m) == nil && m["t"] == "error" && m["error"] == "ocupado" {
			busy = true
		}
	}
	if !busy {
		t.Error("el segundo visor debía recibir 'ocupado'")
	}
}

func TestAllowedViewerIPs(t *testing.T) {
	e := start(t, `{"allowedViewerIPs":["192.168.50.0/24"]}`, true)
	if r, err := visor.Dial(context.Background(), e.addr, e.pair, "v"); err == nil {
		r.Conn.Close()
		t.Fatal("127.0.0.1 no está en allowedViewerIPs")
	}
	e2 := start(t, `{"allowedViewerIPs":["127.0.0.1"]}`, true)
	r, err := visor.Dial(context.Background(), e2.addr, e2.pair, "v")
	if err != nil {
		t.Fatalf("127.0.0.1 sí está permitida: %v", err)
	}
	r.Conn.Close()
}

func TestTLS12Refused(t *testing.T) {
	e := start(t, `{}`, true)
	_, err := tls.Dial("tcp", e.addr.String(), &tls.Config{InsecureSkipVerify: true, MaxVersion: tls.VersionTLS12})
	if err == nil {
		t.Fatal("TLS 1.2 no debe aceptarse")
	}
}

func TestIdentityCreateLoadRotate(t *testing.T) {
	dir := t.TempDir()
	a, err := lanserver.LoadOrCreateIdentity(dir, "PC", 5911)
	if err != nil || !a.Created || len(a.Secret) != 32 {
		t.Fatalf("crear: %v %+v", err, a)
	}
	b, err := lanserver.LoadOrCreateIdentity(dir, "PC", 5911)
	if err != nil || b.Created || b.Pairing.Secret != a.Pairing.Secret || b.Pairing.Fingerprint != a.Pairing.Fingerprint {
		t.Fatalf("cargar debe conservar la llave: %v", err)
	}
	removeFile(t, dir+"/"+lanserver.PairingFile) // rotar = borrar pairing.json
	c, err := lanserver.LoadOrCreateIdentity(dir, "PC", 5911)
	if err != nil || !c.Created || c.Pairing.Secret == a.Pairing.Secret || c.Pairing.Fingerprint == a.Pairing.Fingerprint {
		t.Fatalf("rotar debe dar secreto y huella nuevos: %v", err)
	}
	if err := c.Pairing.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestConfig(t *testing.T) {
	c, err := lanserver.ParseConfig(nil, "mi-pc")
	if err != nil || c.Port != 5911 || c.Name != "mi-pc" || !c.AnnounceEnabled() {
		t.Fatalf("defaults: %+v %v", c, err)
	}
	c, _ = lanserver.ParseConfig([]byte(`{"announce":false,"port":6000,"name":" X "}`), "h")
	if c.AnnounceEnabled() || c.Port != 6000 || c.Name != "X" {
		t.Fatalf("%+v", c)
	}
	for _, bad := range []string{`{"port":70000}`, `{"allowedViewerIPs":["nada"]}`, `no json`} {
		if _, err := lanserver.ParseConfig([]byte(bad), "h"); err == nil {
			t.Errorf("debía fallar: %s", bad)
		}
	}
}

func TestAnnouncerSendsOnlyNameAndPort(t *testing.T) {
	pc, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go lanserver.RunAnnouncer(ctx, "PC Caja", 5911, []*net.UDPAddr{pc.LocalAddr().(*net.UDPAddr)})
	buf := make([]byte, 1024)
	pc.SetReadDeadline(time.Now().Add(3 * time.Second))
	n, _, err := pc.ReadFromUDP(buf)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(buf[:n], &m)
	if len(m) != 2 || m["name"] != "PC Caja" || m["port"] != float64(5911) {
		t.Fatalf("el anuncio solo debe llevar name y port: %s", buf[:n])
	}
	a, err := proto.ParseAnnounce(buf[:n])
	if err != nil || a.Name != "PC Caja" || a.Port != 5911 {
		t.Fatalf("%+v %v", a, err)
	}
}

func removeFile(t *testing.T, p string) {
	t.Helper()
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
}
