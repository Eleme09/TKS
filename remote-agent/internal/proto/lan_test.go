package proto

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestAuthMAC(t *testing.T) {
	secret := bytes.Repeat([]byte{7}, 32)
	ekm := []byte("material-de-sesion-tls")
	mac := AuthMAC(secret, RoleVisor, ekm)
	if !VerifyAuthMAC(secret, RoleVisor, ekm, mac) {
		t.Fatal("la prueba correcta debe verificar")
	}
	if VerifyAuthMAC(bytes.Repeat([]byte{8}, 32), RoleVisor, ekm, mac) {
		t.Error("secreto distinto")
	}
	if VerifyAuthMAC(secret, RoleVisor, []byte("otra-sesion"), mac) {
		t.Error("otra sesión TLS: no se puede repetir una prueba capturada")
	}
	if VerifyAuthMAC(secret, RoleServidor, ekm, mac) {
		t.Error("la prueba del visor no sirve como prueba del servidor")
	}
	for _, bad := range []string{"", "zz", "00", strings.Repeat("0", 64)} {
		if VerifyAuthMAC(secret, RoleVisor, ekm, bad) {
			t.Errorf("no debe aceptar %q", bad)
		}
	}
}

func TestSecretBytes(t *testing.T) {
	if _, err := SecretBytes(strings.Repeat("ab", 32)); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"", "ab", strings.Repeat("zz", 32), strings.Repeat("ab", 31)} {
		if _, err := SecretBytes(bad); err == nil {
			t.Errorf("debe fallar: %q", bad)
		}
	}
}

func TestFrames(t *testing.T) {
	var buf bytes.Buffer
	WriteFrame(&buf, FrameText, []byte(`{"t":"ping"}`))
	WriteFrame(&buf, FrameBinary, []byte{1, 2, 3})
	typ, p, err := ReadFrame(&buf, 100)
	if err != nil || typ != FrameText || string(p) != `{"t":"ping"}` {
		t.Fatal(typ, p, err)
	}
	typ, p, err = ReadFrame(&buf, 100)
	if err != nil || typ != FrameBinary || len(p) != 3 {
		t.Fatal(typ, p, err)
	}
	// demasiado grande: se rechaza sin leer el cuerpo
	big := bytes.NewReader([]byte{FrameText, 0x7f, 0xff, 0xff, 0xff})
	if _, _, err := ReadFrame(big, 1024); err == nil {
		t.Error("frame gigante debe rechazarse")
	}
	// tipo inválido
	if _, _, err := ReadFrame(bytes.NewReader([]byte{9, 0, 0, 0, 0}), 10); err == nil {
		t.Error("tipo inválido")
	}
	// cortado
	if _, _, err := ReadFrame(bytes.NewReader([]byte{1, 0, 0, 0, 9, 'a'}), 10); err == nil {
		t.Error("frame cortado")
	}
}

func TestAnnounceParse(t *testing.T) {
	b := MarshalAnnounce(Announce{Name: "PC Caja", Port: 5911})
	var m map[string]any
	json.Unmarshal(b, &m)
	if len(m) != 2 {
		t.Fatalf("solo name y port: %s", b)
	}
	a, err := ParseAnnounce(b)
	if err != nil || a.Name != "PC Caja" || a.Port != 5911 {
		t.Fatal(a, err)
	}
	a, err = ParseAnnounce([]byte("{\"name\":\"X\\u0000\\nY\",\"port\":80}"))
	if err != nil || a.Name != "XY" {
		t.Errorf("control chars: %q %v", a.Name, err)
	}
	for _, bad := range []string{``, `no`, `{"name":"a","port":0}`, `{"name":"a","port":70000}`, `{"name":"","port":5}`, `{"name":"\u0000","port":5}`, `{"name":"` + strings.Repeat("a", 600) + `","port":5}`} {
		if _, err := ParseAnnounce([]byte(bad)); err == nil {
			t.Errorf("debe fallar: %.40s", bad)
		}
	}
	long, _ := ParseAnnounce([]byte(`{"name":"` + strings.Repeat("a", 200) + `","port":5}`))
	if len([]rune(long.Name)) != 60 {
		t.Errorf("nombre recortado a 60: %d", len(long.Name))
	}
}

func TestParsePairing(t *testing.T) {
	good := `{"name":"PC","port":5911,"secret":"` + strings.Repeat("ab", 32) + `","fingerprint":"` + strings.Repeat("cd", 32) + `"}`
	if _, err := ParsePairing([]byte(good)); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{``, `{}`, `no json`,
		strings.Replace(good, `"port":5911`, `"port":0`, 1),
		strings.Replace(good, strings.Repeat("ab", 32), "abc", 1),
		strings.Replace(good, strings.Repeat("cd", 32), strings.Repeat("zz", 32), 1)} {
		if _, err := ParsePairing([]byte(bad)); err == nil {
			t.Errorf("debe fallar: %.50s", bad)
		}
	}
}

func TestParseViewerMsg(t *testing.T) {
	ok := []string{
		`{"t":"ping"}`,
		`{"t":"mouse","a":"move","x":0,"y":1}`,
		`{"t":"mouse","a":"down","b":2,"x":0.5,"y":0.5}`,
		`{"t":"mouse","a":"wheel","d":-1}`,
		`{"t":"key","a":"down","code":"KeyA"}`,
		`{"t":"quality","q":2}`,
	}
	for _, s := range ok {
		if _, err := ParseViewerMsg([]byte(s)); err != nil {
			t.Errorf("%s: %v", s, err)
		}
	}
	bad := []string{``, `x`, `{}`, `{"t":"evil"}`,
		`{"t":"mouse","a":"move","x":2,"y":0}`, `{"t":"mouse","a":"move","y":0}`, `{"t":"mouse","a":"move","x":-0.1,"y":0}`,
		`{"t":"mouse","a":"down","b":5,"x":0,"y":0}`, `{"t":"mouse","a":"down","x":0,"y":0}`,
		`{"t":"mouse","a":"wheel","d":5}`, `{"t":"mouse","a":"zoom"}`,
		`{"t":"key","a":"down","code":"Key A"}`, `{"t":"key","a":"hold","code":"KeyA"}`, `{"t":"key","a":"down","code":"` + strings.Repeat("a", 30) + `"}`,
		`{"t":"quality","q":9}`, `{"t":"quality"}`, `{"t":"text","text":"hola"}`,
		`{"t":"ping","pad":"` + strings.Repeat("a", 3000) + `"}`}
	for _, s := range bad {
		if _, err := ParseViewerMsg([]byte(s)); err == nil {
			t.Errorf("debe rechazarse: %.60s", s)
		}
	}
	m, _ := ParseViewerMsg([]byte(`{"t":"key","a":"up","code":"KeyA","extra":"x"}`))
	if m.T != "key" || m.A != "up" || m.Code != "KeyA" {
		t.Error(m)
	}
}
