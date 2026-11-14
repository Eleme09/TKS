package visor

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/netip"
	"strconv"
	"time"

	"placer/remote-agent/internal/proto"
)

var (
	ErrPinMismatch = errors.New("el certificado de ese equipo no coincide con el emparejamiento")
	ErrNotAuthed   = errors.New("el equipo no aceptó el emparejamiento")
	ErrBadAddr     = errors.New("dirección no válida: escribe una IP de tu red local y el puerto (ej. 192.168.1.20:5911)")
)

// ParseLANAddr valida "ip:puerto": solo IP literal de red local.
func ParseLANAddr(s string) (netip.AddrPort, error) {
	ap, err := netip.ParseAddrPort(s)
	if err != nil || ap.Port() == 0 || !IsLANAddr(ap.Addr()) {
		return netip.AddrPort{}, ErrBadAddr
	}
	return ap, nil
}

// Remote es una conexión ya autenticada con un servidor.
type Remote struct {
	Conn net.Conn
	Name string
}

var dialTimeout = 6 * time.Second
var authTimeout = 8 * time.Second

// Dial abre TLS 1.3 fijando la huella del certificado, demuestra el secreto
// del emparejamiento y verifica que el servidor también lo conoce.
func Dial(ctx context.Context, addr netip.AddrPort, p proto.Pairing, viewer string) (*Remote, error) {
	secret, err := proto.SecretBytes(p.Secret)
	if err != nil {
		return nil, err
	}
	conf := &tls.Config{
		MinVersion:         tls.VersionTLS13,
		MaxVersion:         tls.VersionTLS13,
		InsecureSkipVerify: true, // se sustituye por el pinning de abajo
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return ErrPinMismatch
			}
			sum := sha256.Sum256(cs.PeerCertificates[0].Raw)
			if hex.EncodeToString(sum[:]) != p.Fingerprint {
				return ErrPinMismatch
			}
			return nil
		},
	}
	d := tls.Dialer{NetDialer: &net.Dialer{Timeout: dialTimeout}, Config: conf}
	c, err := d.DialContext(ctx, "tcp", addr.String())
	if err != nil {
		if errors.Is(err, ErrPinMismatch) {
			return nil, ErrPinMismatch
		}
		return nil, errors.New("no se pudo conectar con " + addr.String())
	}
	tc := c.(*tls.Conn)
	fail := func(e error) (*Remote, error) { c.Close(); return nil, e }
	st := tc.ConnectionState()
	ekm, err := st.ExportKeyingMaterial(proto.AuthExporterLabel, nil, 32)
	if err != nil {
		return fail(err)
	}
	c.SetDeadline(time.Now().Add(authTimeout))
	if err := proto.WriteFrame(c, proto.FrameText, proto.ViewerAuthMsg(proto.AuthMAC(secret, proto.RoleVisor, ekm), viewer)); err != nil {
		return fail(ErrNotAuthed)
	}
	typ, data, err := proto.ReadFrame(c, proto.MaxPreAuthFrame)
	if err != nil || typ != proto.FrameText {
		return fail(ErrNotAuthed) // el servidor cierra en silencio si no lo reconoce
	}
	var ok struct {
		T     string `json:"t"`
		Proof string `json:"proof"`
		Name  string `json:"name"`
	}
	if json.Unmarshal(data, &ok) != nil || ok.T != "authok" || !proto.VerifyAuthMAC(secret, proto.RoleServidor, ekm, ok.Proof) {
		return fail(ErrNotAuthed)
	}
	c.SetDeadline(time.Time{})
	return &Remote{Conn: c, Name: ok.Name}, nil
}

// HostPort arma "ip:puerto".
func HostPort(ip string, port int) string { return net.JoinHostPort(ip, strconv.Itoa(port)) }
