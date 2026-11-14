package main

import (
	"image"
	"image/color"
	"strings"
	"testing"
)

func TestBuildAgentURL(t *testing.T) {
	ok := map[string]string{
		"tks.example.com":         "wss://tks.example.com/ws/remote/agent",
		"wss://tks.example.com/":  "wss://tks.example.com/ws/remote/agent",
		"https://tks.example.com": "wss://tks.example.com/ws/remote/agent",
	}
	for in, want := range ok {
		got, err := BuildAgentURL(in, false)
		if err != nil || got != want {
			t.Errorf("%q → %q, %v (esperaba %q)", in, got, err, want)
		}
	}
	if _, err := BuildAgentURL("ws://localhost:3000", false); err == nil {
		t.Error("ws:// debería rechazarse sin allowInsecure")
	}
	if _, err := BuildAgentURL("http://x", false); err == nil {
		t.Error("http:// debería rechazarse sin allowInsecure")
	}
	got, err := BuildAgentURL("ws://localhost:3000", true)
	if err != nil || got != "ws://localhost:3000/ws/remote/agent" {
		t.Errorf("allowInsecure: %q %v", got, err)
	}
	if _, err := BuildAgentURL("ftp://x", true); err == nil {
		t.Error("esquema ftp debería fallar")
	}
}

func TestParseConfig(t *testing.T) {
	if _, err := ParseConfig([]byte(`{"server":"a.com","device":"d","token":"t"}`)); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{`{}`, `{"server":"a.com","device":"d"}`, `no json`, `{"server":"ws://a","device":"d","token":"t"}`} {
		if _, err := ParseConfig([]byte(bad)); err == nil {
			t.Errorf("debería fallar: %s", bad)
		}
	}
}

func TestMessages(t *testing.T) {
	if got := string(consentMsg(true)); got != `{"ok":true,"t":"consent","viewOnly":false}` {
		t.Error(got)
	}
	if !strings.Contains(string(authMsg("d", "t")), `"t":"auth"`) {
		t.Error("auth")
	}
	m, err := parseIn([]byte(`{"t":"mouse","a":"wheel","d":-1}`))
	if err != nil || m.T != "mouse" || m.D != -1 {
		t.Error(m, err)
	}
	if _, err := parseIn([]byte(`{}`)); err == nil {
		t.Error("sin t debe fallar")
	}
}

func TestSanitizeViewer(t *testing.T) {
	if SanitizeViewer("  \x00\n ") != "un administrador" {
		t.Error("vacío")
	}
	if SanitizeViewer("Elemee\r\nFalso") != "ElemeeFalso" {
		t.Error(SanitizeViewer("Elemee\r\nFalso"))
	}
	if len([]rune(SanitizeViewer(strings.Repeat("a", 200)))) != maxViewerNameLn {
		t.Error("largo")
	}
}

func TestQuality(t *testing.T) {
	if q, ok := QualityFromMsg(0.5); !ok || q != 50 {
		t.Error(q)
	}
	if q, _ := QualityFromMsg(500); q != 90 {
		t.Error(q)
	}
	if _, ok := QualityFromMsg(0); ok {
		t.Error("0 no válido")
	}
}

func TestKeyMap(t *testing.T) {
	g := NewKeyGuard()
	cases := map[string]uint16{"KeyA": 0x41, "Digit5": 0x35, "F12": 0x7B, "Enter": 0x0D, "Numpad3": 0x63, "Space": 0x20}
	for code, vk := range cases {
		got, _, ok := g.Filter("down", code)
		if !ok || got != vk {
			t.Errorf("%s → %x %v", code, got, ok)
		}
	}
	if _, ext, ok := g.Filter("down", "ArrowUp"); !ok || !ext {
		t.Error("flecha debe ser extendida")
	}
	for _, bad := range []string{"MetaLeft", "MetaRight", "OSLeft", "Foo", "", "LaunchApp1"} {
		if _, _, ok := g.Filter("down", bad); ok {
			t.Errorf("%q debería bloquearse", bad)
		}
	}
	if _, _, ok := g.Filter("hold", "KeyA"); ok {
		t.Error("acción desconocida")
	}
}

func TestCtrlAltDelBlocked(t *testing.T) {
	g := NewKeyGuard()
	g.Filter("down", "ControlLeft")
	g.Filter("down", "AltRight")
	if _, _, ok := g.Filter("down", "Delete"); ok {
		t.Error("Ctrl+Alt+Supr debe bloquearse")
	}
	g.Filter("up", "AltRight")
	if _, _, ok := g.Filter("down", "Delete"); !ok {
		t.Error("Ctrl+Supr solo sí se permite")
	}
}

func TestUpWithoutDown(t *testing.T) {
	g := NewKeyGuard()
	if _, _, ok := g.Filter("up", "KeyA"); ok {
		t.Error("up sin down de tecla normal se ignora")
	}
	if _, _, ok := g.Filter("up", "ShiftLeft"); !ok {
		t.Error("up de modificador sí")
	}
	g.Filter("down", "KeyB")
	if len(g.PressedCodes()) != 1 {
		t.Error("PressedCodes")
	}
	g.Reset()
	if len(g.PressedCodes()) != 0 {
		t.Error("Reset")
	}
}

func TestScaledSize(t *testing.T) {
	if w, h := ScaledSize(1920, 1080, 1600); w != 1600 || h != 900 {
		t.Error(w, h)
	}
	if w, h := ScaledSize(1280, 720, 1600); w != 1280 || h != 720 {
		t.Error(w, h)
	}
	if w, _ := ScaledSize(0, 5, 1600); w != 0 {
		t.Error("cero")
	}
}

func TestFrameEncoderSkipsIdentical(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 2000, 1000))
	for y := 0; y < 1000; y++ {
		for x := 0; x < 2000; x++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 7, 255})
		}
	}
	e := NewFrameEncoder()
	data, w, h, send, err := e.Encode(img, 60)
	if err != nil || !send || w != 1600 || h != 800 || len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		t.Fatalf("primer frame: %v %v %d %d", err, send, w, h)
	}
	if _, _, _, send, _ := e.Encode(img, 60); send {
		t.Error("frame idéntico no debe enviarse")
	}
	e.ForceNext()
	if _, _, _, send, _ := e.Encode(img, 60); !send {
		t.Error("ForceNext debe reenviar")
	}
	img.Set(5, 5, color.RGBA{1, 2, 3, 255})
	if _, _, _, send, _ := e.Encode(img, 60); !send {
		t.Error("frame distinto debe enviarse")
	}
}
