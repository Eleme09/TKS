package proto

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// Autenticación mutua en la red local, SIN contraseña tecleada:
//
//   - Ambos lados comparten un secreto aleatorio de 256 bits (pairing.json).
//   - El canal es TLS 1.3 y el visor fija la huella del certificado del servidor.
//   - La prueba es HMAC-SHA256(secreto, rol|material-de-la-sesión-TLS). Ese
//     material (RFC 5705, ExportKeyingMaterial) es único por conexión TLS, así
//     que no se puede repetir una prueba capturada ni retransmitirla a otro
//     servidor, y el servidor no tiene que mandar ningún reto antes de que el
//     visor demuestre quién es (un cliente sin secreto no recibe ni un byte).

// AuthExporterLabel es la etiqueta de ExportKeyingMaterial.
const AuthExporterLabel = "EXPERIMENTAL-placer-remote-auth"

const (
	RoleVisor    = "visor"
	RoleServidor = "servidor"
)

// SecretBytes decodifica el secreto del pairing (64 hex = 256 bits).
func SecretBytes(secretHex string) ([]byte, error) {
	b, err := hex.DecodeString(secretHex)
	if err != nil || len(b) != 32 {
		return nil, errBadSecret
	}
	return b, nil
}

// AuthMAC calcula la prueba de un rol sobre el material de la sesión TLS.
func AuthMAC(secret []byte, role string, ekm []byte) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(role + "|"))
	h.Write(ekm)
	return hex.EncodeToString(h.Sum(nil))
}

// VerifyAuthMAC compara en tiempo constante.
func VerifyAuthMAC(secret []byte, role string, ekm []byte, gotHex string) bool {
	got, err := hex.DecodeString(gotHex)
	if err != nil {
		return false
	}
	want, _ := hex.DecodeString(AuthMAC(secret, role, ekm))
	return hmac.Equal(want, got)
}

// ViewerAuthMsg es el primer mensaje del visor (dentro del túnel TLS).
func ViewerAuthMsg(mac, viewer string) []byte {
	b, _ := json.Marshal(map[string]string{"t": "auth", "mac": mac, "viewer": viewer})
	return b
}

// AuthReply es lo que el servidor lee como primer mensaje.
type AuthReply struct {
	T      string `json:"t"`
	MAC    string `json:"mac"`
	Viewer string `json:"viewer"`
}

// AuthOkMsg: respuesta del servidor, solo tras una prueba válida.
func AuthOkMsg(proof, name string) []byte {
	b, _ := json.Marshal(map[string]string{"t": "authok", "proof": proof, "name": name})
	return b
}

func ErrorMsg(text string) []byte {
	b, _ := json.Marshal(map[string]string{"t": "error", "error": text})
	return b
}
