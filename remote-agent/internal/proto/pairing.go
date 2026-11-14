package proto

import (
	"encoding/hex"
	"encoding/json"
	"errors"
)

// Pairing es el contenido de pairing.json: lo genera el servidor la primera
// vez y el administrador lo copia UNA vez al visor. Contiene el secreto.
type Pairing struct {
	Name        string `json:"name"`
	Port        int    `json:"port"`
	Secret      string `json:"secret"`      // 256 bits en hex
	Fingerprint string `json:"fingerprint"` // SHA-256 del certificado, hex
}

func isHex(s string, n int) bool {
	if len(s) != n {
		return false
	}
	_, err := hex.DecodeString(s)
	return err == nil
}

// Validate normaliza y valida (viene de un archivo que alguien copió).
func (p *Pairing) Validate() error {
	p.Name = cleanText(p.Name)
	if p.Name == "" {
		return errors.New("el archivo no tiene nombre")
	}
	if p.Port < 1 || p.Port > 65535 {
		return errors.New("puerto inválido")
	}
	if !isHex(p.Secret, 64) {
		return errors.New("secreto inválido")
	}
	if !isHex(p.Fingerprint, 64) {
		return errors.New("huella inválida")
	}
	return nil
}

func ParsePairing(data []byte) (Pairing, error) {
	var p Pairing
	if len(data) == 0 || len(data) > 4096 {
		return p, errors.New("archivo de emparejamiento inválido")
	}
	if err := json.Unmarshal(data, &p); err != nil {
		return p, errors.New("archivo de emparejamiento inválido")
	}
	return p, p.Validate()
}
