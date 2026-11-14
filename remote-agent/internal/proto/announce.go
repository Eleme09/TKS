package proto

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode"
)

// Anuncio UDP broadcast que el servidor emite cada 3 s para que el visor
// lo detecte en la red local. La IP real la toma el visor del origen del paquete.

const (
	AnnouncePort     = 5910
	DefaultPort      = 5911
	AnnounceInterval = 3 // segundos
	ProtocolVersion  = 1
	maxAnnounceBytes = 512
	maxAnnounceText  = 60
)

// Announce solo lleva nombre y puerto (sin versión ni datos sensibles). La IP
// real la toma el visor del origen del paquete.
type Announce struct {
	Name string `json:"name"`
	Port int    `json:"port"`
}

func cleanText(s string) string {
	var sb strings.Builder
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) || r == '�' {
			continue
		}
		sb.WriteRune(r)
		if n++; n >= maxAnnounceText {
			break
		}
	}
	return strings.TrimSpace(sb.String())
}

func MarshalAnnounce(a Announce) []byte {
	b, _ := json.Marshal(a)
	return b
}

// ParseAnnounce valida y limpia un paquete recibido por UDP (viene de la red).
func ParseAnnounce(data []byte) (Announce, error) {
	var a Announce
	if len(data) == 0 || len(data) > maxAnnounceBytes {
		return a, errors.New("tamaño inválido")
	}
	if err := json.Unmarshal(data, &a); err != nil {
		return a, err
	}
	if a.Port < 1 || a.Port > 65535 {
		return a, errors.New("puerto inválido")
	}
	a.Name = cleanText(a.Name)
	if a.Name == "" {
		return a, errors.New("sin nombre")
	}
	return a, nil
}
