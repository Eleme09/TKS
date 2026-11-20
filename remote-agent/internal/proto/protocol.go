package proto

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"
)

// Parte portable (sin Windows): configuración, mensajes del protocolo y
// utilidades de texto. Protocolo definido por remote/relay.js del repo TKS.

const (
	AgentPath       = "/ws/remote/agent"
	ConsentTimeout  = 30 // segundos
	PingEverySec    = 30
	MaxViewerNameLn = 40
)

// Config se lee de config.json junto al .exe.
type Config struct {
	Server        string `json:"server"`
	Device        string `json:"device"`
	Token         string `json:"token"`
	AllowInsecure bool   `json:"allowInsecure"`
	// Unattended: acepta sesiones sin mostrar el aviso Sí/No. Decisión LOCAL de
	// quien instala el agente; el servidor no puede activarla.
	Unattended bool `json:"unattended"`
	// MaxWidth: ancho máximo (px) de la imagen enviada. 0 → 1600.
	MaxWidth int `json:"maxWidth"`
	// MaxFPS: tope de cuadros por segundo. 0 → 20 (máximo 30).
	MaxFPS int `json:"maxFps"`
}

// ParseConfig valida el contenido de config.json.
func ParseConfig(data []byte) (Config, error) {
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return c, fmt.Errorf("config.json inválido: %w", err)
	}
	c.Server = strings.TrimSpace(c.Server)
	c.Device = strings.TrimSpace(c.Device)
	c.Token = strings.TrimSpace(c.Token)
	if c.Server == "" || c.Device == "" || c.Token == "" {
		return c, errors.New("config.json debe tener server, device y token")
	}
	if _, err := BuildAgentURL(c.Server, c.AllowInsecure); err != nil {
		return c, err
	}
	if c.MaxWidth != 0 && (c.MaxWidth < 320 || c.MaxWidth > 4096) {
		return c, errors.New("maxWidth debe estar entre 320 y 4096")
	}
	if c.MaxFPS < 0 || c.MaxFPS > 30 {
		return c, errors.New("maxFps debe estar entre 1 y 30")
	}
	return c, nil
}

// BuildAgentURL arma wss://host/ws/remote/agent. Acepta "host", "wss://host",
// "https://host". ws:// / http:// solo con allowInsecure (pruebas locales).
func BuildAgentURL(server string, allowInsecure bool) (string, error) {
	s := strings.TrimSpace(server)
	if s == "" {
		return "", errors.New("server vacío")
	}
	if !strings.Contains(s, "://") {
		s = "wss://" + s
	}
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("server inválido: %q", server)
	}
	switch strings.ToLower(u.Scheme) {
	case "wss", "https":
		u.Scheme = "wss"
	case "ws", "http":
		if !allowInsecure {
			return "", errors.New("ws:// no permitido: usa wss:// (o allowInsecure:true solo para pruebas locales)")
		}
		u.Scheme = "ws"
	default:
		return "", fmt.Errorf("esquema no soportado: %s", u.Scheme)
	}
	return u.Scheme + "://" + u.Host + AgentPath, nil
}

// ---- Mensajes ----

// InMsg es cualquier mensaje de control entrante (relay → agente).
type InMsg struct {
	T      string  `json:"t"`
	Viewer string  `json:"viewer,omitempty"`
	Name   string  `json:"name,omitempty"`
	A      string  `json:"a,omitempty"`
	X      float64 `json:"x,omitempty"`
	Y      float64 `json:"y,omitempty"`
	B      int     `json:"b,omitempty"`
	D      float64 `json:"d,omitempty"`
	Code   string  `json:"code,omitempty"`
	Q      float64 `json:"q,omitempty"`
	Text   string  `json:"text,omitempty"`
	Seq    float64 `json:"seq,omitempty"`
	Resync bool    `json:"resync,omitempty"`
	Tiles  bool    `json:"tiles,omitempty"`
}

func ParseIn(data []byte) (InMsg, error) {
	var m InMsg
	if err := json.Unmarshal(data, &m); err != nil {
		return m, err
	}
	if m.T == "" {
		return m, errors.New("mensaje sin tipo")
	}
	return m, nil
}

func AuthMsg(device, token string) []byte {
	b, _ := json.Marshal(map[string]string{"t": "auth", "device": device, "token": token})
	return b
}

func InfoMsg(w, h int, host, os string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "info", "w": w, "h": h, "host": host, "os": os})
	return b
}

func ConsentMsg(ok, viewOnly bool) []byte { return ConsentMsgFull(ok, viewOnly, false) }

// ConsentMsgFull añade el campo opcional unattended (solo cuando es true) para
// que el relay lo deje en la auditoría.
func ConsentMsgFull(ok, viewOnly, unattended bool) []byte {
	m := map[string]any{"t": "consent", "ok": ok, "viewOnly": viewOnly}
	if unattended {
		m["unattended"] = true
	}
	b, _ := json.Marshal(m)
	return b
}

// StatMsg: estadísticas del agente para la barra del visor (RTT agente↔visor medido con los ack).
func StatMsg(rttMs, fps, kbps int, level string) []byte {
	b, _ := json.Marshal(map[string]any{"t": "stat", "rtt": rttMs, "fps": fps, "kbps": kbps, "mode": level})
	return b
}

// MaxTextRunes: tope de texto por mensaje {t:'text'} (igual que relay.js).
const MaxTextRunes = 200

// CleanText descarta controles (salvo \n y \t) y recorta a MaxTextRunes.
func CleanText(s string) string {
	var sb strings.Builder
	n := 0
	for _, r := range s {
		if r == '\r' || r == '�' {
			continue
		}
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			continue
		}
		sb.WriteRune(r)
		n++
		if n >= MaxTextRunes {
			break
		}
	}
	return sb.String()
}

func PingMsg() []byte { return []byte(`{"t":"ping"}`) }

// SanitizeViewer limpia el nombre que se muestra en el diálogo (viene de la red).
func SanitizeViewer(s string) string {
	var sb strings.Builder
	n := 0
	for _, r := range s {
		if unicode.IsControl(r) || r == '�' {
			continue
		}
		sb.WriteRune(r)
		n++
		if n >= MaxViewerNameLn {
			break
		}
	}
	out := strings.TrimSpace(sb.String())
	if out == "" {
		return "un administrador"
	}
	return out
}

var qualityLevels = map[int]int{1: 40, 2: 60, 3: 85}

// QualityFromMsg traduce el mensaje {t:'quality'} a calidad JPEG (20..90).
func QualityFromMsg(q float64) (int, bool) {
	if q <= 0 {
		return 0, false
	}
	if q == 1 || q == 2 || q == 3 { // niveles del visor web: 1 baja, 2 media, 3 alta
		return qualityLevels[int(q)], true
	}
	if q < 1 { // fracción 0..1
		q *= 100
	}
	v := int(q)
	if v < 20 {
		v = 20
	}
	if v > 90 {
		v = 90
	}
	return v, true
}

// ---- Validación estricta de mensajes del visor (modo red local) ----

// MaxControlBytes es el tamaño máximo de un mensaje de control del visor.
const MaxControlBytes = 2048

var keyCodeRE = regexp.MustCompile(`^[A-Za-z0-9]{1,20}$`)

// ParseViewerMsg valida un mensaje del visor campo por campo (mismas reglas
// que remote/relay.js) y devuelve una copia limpia. Cualquier otra cosa → error.
func ParseViewerMsg(data []byte) (InMsg, error) {
	var out InMsg
	if len(data) == 0 || len(data) > MaxControlBytes {
		return out, errors.New("tamaño inválido")
	}
	var raw struct {
		T    string   `json:"t"`
		A    string   `json:"a"`
		X    *float64 `json:"x"`
		Y    *float64 `json:"y"`
		B    *float64 `json:"b"`
		D    *float64 `json:"d"`
		Code string   `json:"code"`
		Q    *float64 `json:"q"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return out, err
	}
	unit := func(p *float64) bool { return p != nil && *p >= 0 && *p <= 1 }
	switch raw.T {
	case "ping":
		return InMsg{T: "ping"}, nil
	case "mouse":
		switch raw.A {
		case "wheel":
			if raw.D == nil || (*raw.D != 1 && *raw.D != -1) {
				return out, errors.New("rueda inválida")
			}
			return InMsg{T: "mouse", A: "wheel", D: *raw.D}, nil
		case "move":
			if !unit(raw.X) || !unit(raw.Y) {
				return out, errors.New("coordenadas inválidas")
			}
			return InMsg{T: "mouse", A: "move", X: *raw.X, Y: *raw.Y}, nil
		case "down", "up":
			if !unit(raw.X) || !unit(raw.Y) || raw.B == nil || (*raw.B != 0 && *raw.B != 1 && *raw.B != 2) {
				return out, errors.New("botón inválido")
			}
			return InMsg{T: "mouse", A: raw.A, B: int(*raw.B), X: *raw.X, Y: *raw.Y}, nil
		}
		return out, errors.New("acción de mouse inválida")
	case "key":
		if (raw.A != "down" && raw.A != "up") || !keyCodeRE.MatchString(raw.Code) {
			return out, errors.New("tecla inválida")
		}
		return InMsg{T: "key", A: raw.A, Code: raw.Code}, nil
	case "quality":
		if raw.Q == nil || (*raw.Q != 1 && *raw.Q != 2 && *raw.Q != 3) {
			return out, errors.New("calidad inválida")
		}
		return InMsg{T: "quality", Q: *raw.Q}, nil
	}
	return out, errors.New("tipo desconocido")
}
