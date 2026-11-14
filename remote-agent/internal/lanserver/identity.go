package lanserver

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
	"time"

	"placer/remote-agent/internal/proto"
)

const (
	PairingFile = "pairing.json"
	CertFile    = "server-cert.pem"
	KeyFile     = "server-key.pem"
)

// Identity: certificado TLS autofirmado + secreto de emparejamiento.
type Identity struct {
	Cert    tls.Certificate
	Secret  []byte
	Pairing proto.Pairing
	Created bool // true si se generó en esta ejecución
}

func fingerprintOf(der []byte) string {
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:])
}

// LoadOrCreateIdentity carga el par certificado+secreto de dir o, si falta
// pairing.json (primer arranque, o rotación borrándolo), genera TODO de nuevo:
// secreto aleatorio de 256 bits y certificado nuevo (huella nueva).
func LoadOrCreateIdentity(dir, name string, port int) (*Identity, error) {
	if id, err := loadIdentity(dir); err == nil {
		return id, nil
	}
	return createIdentity(dir, name, port)
}

func loadIdentity(dir string) (*Identity, error) {
	pdata, err := os.ReadFile(filepath.Join(dir, PairingFile))
	if err != nil {
		return nil, err
	}
	p, err := proto.ParsePairing(pdata)
	if err != nil {
		return nil, err
	}
	secret, err := proto.SecretBytes(p.Secret)
	if err != nil {
		return nil, err
	}
	cert, err := tls.LoadX509KeyPair(filepath.Join(dir, CertFile), filepath.Join(dir, KeyFile))
	if err != nil {
		return nil, err
	}
	if fingerprintOf(cert.Certificate[0]) != p.Fingerprint {
		return nil, errors.New("la huella de pairing.json no corresponde al certificado")
	}
	return &Identity{Cert: cert, Secret: secret, Pairing: p}, nil
}

func createIdentity(dir, name string, port int) (*Identity, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 100))
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "placer-servidor"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(10, 0, 0),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return nil, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	p := proto.Pairing{Name: name, Port: port, Secret: hex.EncodeToString(secret), Fingerprint: fingerprintOf(der)}
	if err := p.Validate(); err != nil {
		return nil, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	pj, _ := json.MarshalIndent(p, "", "  ")
	// Primero el certificado y la clave; pairing.json al final: si algo falla
	// a la mitad, el próximo arranque regenera todo en vez de quedar inconsistente.
	os.Remove(filepath.Join(dir, PairingFile))
	if err := os.WriteFile(filepath.Join(dir, CertFile), certPEM, 0o600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, KeyFile), keyPEM, 0o600); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, PairingFile), append(pj, '\n'), 0o600); err != nil {
		return nil, err
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return nil, err
	}
	return &Identity{Cert: cert, Secret: secret, Pairing: p, Created: true}, nil
}
