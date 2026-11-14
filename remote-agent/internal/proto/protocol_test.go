package proto

import (
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
	if got := string(ConsentMsg(true, false)); got != `{"ok":true,"t":"consent","viewOnly":false}` {
		t.Error(got)
	}
	if !strings.Contains(string(AuthMsg("d", "t")), `"t":"auth"`) {
		t.Error("auth")
	}
	m, err := ParseIn([]byte(`{"t":"mouse","a":"wheel","d":-1}`))
	if err != nil || m.T != "mouse" || m.D != -1 {
		t.Error(m, err)
	}
	if _, err := ParseIn([]byte(`{}`)); err == nil {
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
	if len([]rune(SanitizeViewer(strings.Repeat("a", 200)))) != MaxViewerNameLn {
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
