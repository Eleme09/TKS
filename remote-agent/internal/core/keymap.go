package core

import "strings"

// Mapeo de event.code de JS a teclas virtuales de Windows (lista blanca).
// Lo desconocido se ignora. Win (Meta) solo se permite en modo "control total"
// (agente de nube); Ctrl+Alt+Supr nunca (Windows no deja inyectarlo con
// SendInput: es la "secuencia de atención segura").

type keyInfo struct {
	vk       uint16
	extended bool
}

var keyTable = buildKeyTable()

func buildKeyTable() map[string]keyInfo {
	t := map[string]keyInfo{}
	for c := 'A'; c <= 'Z'; c++ {
		t["Key"+string(c)] = keyInfo{vk: uint16(c)}
	}
	for c := '0'; c <= '9'; c++ {
		t["Digit"+string(c)] = keyInfo{vk: uint16(c)}
		t["Numpad"+string(c)] = keyInfo{vk: 0x60 + uint16(c-'0')}
	}
	for i := 1; i <= 12; i++ {
		t["F"+itoa(i)] = keyInfo{vk: 0x70 + uint16(i-1)}
	}
	set := func(code string, vk uint16, ext bool) { t[code] = keyInfo{vk, ext} }
	set("Enter", 0x0D, false)
	set("NumpadEnter", 0x0D, true)
	set("Escape", 0x1B, false)
	set("Backspace", 0x08, false)
	set("Tab", 0x09, false)
	set("Space", 0x20, false)
	set("CapsLock", 0x14, false)
	set("ShiftLeft", 0xA0, false)
	set("ShiftRight", 0xA1, false)
	set("ControlLeft", 0xA2, false)
	set("ControlRight", 0xA3, true)
	set("AltLeft", 0xA4, false)
	set("AltRight", 0xA5, true)
	set("ArrowLeft", 0x25, true)
	set("ArrowUp", 0x26, true)
	set("ArrowRight", 0x27, true)
	set("ArrowDown", 0x28, true)
	set("Home", 0x24, true)
	set("End", 0x23, true)
	set("PageUp", 0x21, true)
	set("PageDown", 0x22, true)
	set("Insert", 0x2D, true)
	set("Delete", 0x2E, true)
	set("Minus", 0xBD, false)
	set("Equal", 0xBB, false)
	set("BracketLeft", 0xDB, false)
	set("BracketRight", 0xDD, false)
	set("Backslash", 0xDC, false)
	set("Semicolon", 0xBA, false)
	set("Quote", 0xDE, false)
	set("Comma", 0xBC, false)
	set("Period", 0xBE, false)
	set("Slash", 0xBF, false)
	set("Backquote", 0xC0, false)
	set("IntlBackslash", 0xE2, false)
	set("NumpadAdd", 0x6B, false)
	set("NumpadSubtract", 0x6D, false)
	set("NumpadMultiply", 0x6A, false)
	set("NumpadDivide", 0x6F, true)
	set("NumpadDecimal", 0x6E, false)
	set("NumLock", 0x90, true)
	set("PrintScreen", 0x2C, true)
	set("ScrollLock", 0x91, false)
	set("Pause", 0x13, false)
	set("ContextMenu", 0x5D, true)
	set("MetaLeft", 0x5B, true)
	set("MetaRight", 0x5C, true)
	set("OSLeft", 0x5B, true)
	set("OSRight", 0x5C, true)
	return t
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [4]byte
	n := len(b)
	for i > 0 {
		n--
		b[n] = byte('0' + i%10)
		i /= 10
	}
	return string(b[n:])
}

// KeyGuard lleva el estado de teclas pulsadas para bloquear combinaciones
// peligrosas y poder soltarlo todo al cerrar la sesión.
type KeyGuard struct {
	down      map[string]bool
	allowMeta bool
}

// NewKeyGuard: modo restringido (red local): sin tecla Windows.
func NewKeyGuard() *KeyGuard { return &KeyGuard{down: map[string]bool{}} }

// NewKeyGuardFull: control total (agente de nube): permite Win y sus combinaciones.
func NewKeyGuardFull() *KeyGuard { return &KeyGuard{down: map[string]bool{}, allowMeta: true} }

func isMeta(c string) bool { return strings.HasPrefix(c, "Meta") || c == "OSLeft" || c == "OSRight" }

func isCtrl(c string) bool { return c == "ControlLeft" || c == "ControlRight" }
func isAlt(c string) bool  { return c == "AltLeft" || c == "AltRight" }

func (g *KeyGuard) ctrlAltDown() bool {
	return (g.down["ControlLeft"] || g.down["ControlRight"]) && (g.down["AltLeft"] || g.down["AltRight"])
}

// Filter decide si un evento ('down'|'up') se ejecuta. Devuelve la tecla
// virtual, si es extendida y si se permite.
func (g *KeyGuard) Filter(action, code string) (vk uint16, ext bool, ok bool) {
	if isMeta(code) && !g.allowMeta {
		return 0, false, false // tecla Windows bloqueada en modo restringido
	}
	ki, known := keyTable[code]
	if !known {
		return 0, false, false
	}
	switch action {
	case "down":
		if code == "Delete" && g.ctrlAltDown() {
			return 0, false, false // Ctrl+Alt+Supr
		}
		g.down[code] = true
	case "up":
		wasDown := g.down[code]
		delete(g.down, code)
		if !wasDown {
			// Un "up" sin "down" previo: solo se permite para modificadores
			// (evita soltar teclas que nunca pulsó el visor).
			if !(isCtrl(code) || isAlt(code) || isMeta(code) || strings.HasPrefix(code, "Shift")) {
				return 0, false, false
			}
		}
	default:
		return 0, false, false
	}
	return ki.vk, ki.extended, true
}

// PressedCodes devuelve las teclas que siguen pulsadas (para soltarlas).
func (g *KeyGuard) PressedCodes() []string {
	out := make([]string, 0, len(g.down))
	for c := range g.down {
		out = append(out, c)
	}
	return out
}

func (g *KeyGuard) Reset() { g.down = map[string]bool{} }
