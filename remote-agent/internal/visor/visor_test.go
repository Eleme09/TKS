package visor_test

import (
	"context"
	"encoding/json"
	"image"
	"image/color"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/lanserver"
	"placer/remote-agent/internal/proto"
	"placer/remote-agent/internal/visor"
)

func newApp(t *testing.T) (*visor.App, *httptest.Server, string) {
	t.Helper()
	store, err := visor.OpenStore(t.TempDir() + "/p.json")
	if err != nil {
		t.Fatal(err)
	}
	app := visor.NewApp(0, store, visor.NewDiscovery(), "Visor test")
	ts := httptest.NewUnstartedServer(nil)
	ts.Start()
	// El servidor de prueba escucha en 127.0.0.1:N: se construye la app con ese puerto.
	port := ts.Listener.Addr().(*net.TCPAddr).Port
	app = visor.NewApp(port, store, visor.NewDiscovery(), "Visor test")
	ts.Config.Handler = app.Handler()
	t.Cleanup(ts.Close)
	return app, ts, ts.Listener.Addr().String()
}

func get(t *testing.T, url, host string, hdr map[string]string) int {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	if host != "" {
		req.Host = host
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestLocalGuard(t *testing.T) {
	app, ts, _ := newApp(t)
	if c := get(t, ts.URL+"/", "", nil); c != 403 {
		t.Errorf("sin token: %d", c)
	}
	if c := get(t, ts.URL+"/?k=incorrecto", "", nil); c != 403 {
		t.Errorf("token malo: %d", c)
	}
	if c := get(t, ts.URL+"/?k="+app.Token, "", nil); c != 200 {
		t.Errorf("token bueno: %d", c)
	}
	if c := get(t, ts.URL+"/api/state", "", map[string]string{"X-Visor-Token": app.Token}); c != 200 {
		t.Errorf("api con token por cabecera: %d", c)
	}
	// DNS rebinding: Host que no es el propio, aunque el token sea correcto
	if c := get(t, ts.URL+"/?k="+app.Token, "evil.example.com", nil); c != 403 {
		t.Errorf("Host ajeno: %d", c)
	}
	// otra página del navegador (Origin ajeno) con token robado
	if c := get(t, ts.URL+"/api/state", "", map[string]string{"X-Visor-Token": app.Token, "Origin": "https://evil.example.com"}); c != 403 {
		t.Errorf("Origin ajeno: %d", c)
	}
	if !strings.HasPrefix(app.URL(), "http://127.0.0.1:") || !strings.Contains(app.URL(), app.Token) || len(app.Token) != 64 {
		t.Errorf("URL: %s", app.URL())
	}
	if visor.NewToken() == visor.NewToken() {
		t.Error("el token debe ser aleatorio")
	}
}

func TestPairingImportAPI(t *testing.T) {
	app, ts, _ := newApp(t)
	good := `{"name":"PC","port":5911,"secret":"` + strings.Repeat("ab", 32) + `","fingerprint":"` + strings.Repeat("cd", 32) + `"}`
	post := func(body string) int {
		req, _ := http.NewRequest("POST", ts.URL+"/api/pairings", strings.NewReader(body))
		req.Header.Set("X-Visor-Token", app.Token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if c := post(`{"name":"x"}`); c != 400 {
		t.Errorf("inválido: %d", c)
	}
	if c := post(good); c != 200 {
		t.Errorf("válido: %d", c)
	}
	req, _ := http.NewRequest("GET", ts.URL+"/api/state", nil)
	req.Header.Set("X-Visor-Token", app.Token)
	resp, _ := http.DefaultClient.Do(req)
	var st struct {
		Pairings []map[string]any `json:"pairings"`
	}
	json.NewDecoder(resp.Body).Decode(&st)
	resp.Body.Close()
	if len(st.Pairings) != 1 {
		t.Fatalf("%+v", st)
	}
	for k := range st.Pairings[0] {
		if k == "secret" || k == "Secret" {
			t.Error("el secreto nunca debe llegar al navegador")
		}
	}
}

func TestParseLANAddr(t *testing.T) {
	for _, ok := range []string{"192.168.1.20:5911", "10.0.0.5:1", "127.0.0.1:5911", "172.16.3.4:80"} {
		if _, err := visor.ParseLANAddr(ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{"8.8.8.8:5911", "ejemplo.com:5911", "192.168.1.20", "192.168.1.20:0", "", "[2001:db8::1]:80"} {
		if _, err := visor.ParseLANAddr(bad); err == nil {
			t.Errorf("debe rechazarse (no es red local): %q", bad)
		}
	}
}

func TestDiscoveryTTL(t *testing.T) {
	d := visor.NewDiscovery()
	d.Observe(netip.MustParseAddr("192.168.1.7"), proto.Announce{Name: "PC A", Port: 5911})
	d.Observe(netip.MustParseAddr("8.8.8.8"), proto.Announce{Name: "Fuera", Port: 5911}) // no es LAN
	l := d.List()
	if len(l) != 1 || l[0].Name != "PC A" || l[0].IP != "192.168.1.7" || l[0].Port != 5911 {
		t.Fatalf("%+v", l)
	}
}

func TestDiscoveryListenUDP(t *testing.T) {
	probe, _ := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1)})
	port := probe.LocalAddr().(*net.UDPAddr).Port
	probe.Close()
	d := visor.NewDiscovery()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go d.Listen(ctx, port)
	time.Sleep(200 * time.Millisecond)
	c, _ := net.DialUDP("udp4", nil, &net.UDPAddr{IP: net.IPv4(127, 0, 0, 1), Port: port})
	c.Write([]byte("basura"))
	c.Write(proto.MarshalAnnounce(proto.Announce{Name: "PC UDP", Port: 5911}))
	c.Close()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if l := d.List(); len(l) == 1 && l[0].Name == "PC UDP" {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("no se detectó el anuncio por UDP")
}

func TestStoreReplacesSameName(t *testing.T) {
	path := t.TempDir() + "/p.json"
	s, _ := visor.OpenStore(path)
	mk := func(name, fp string) proto.Pairing {
		return proto.Pairing{Name: name, Port: 5911, Secret: strings.Repeat("ab", 32), Fingerprint: strings.Repeat(fp, 32)}
	}
	s.Add(mk("PC", "cd"))
	s.Add(mk("pc", "ef")) // mismo nombre, llave rotada: reemplaza
	s.Add(mk("Otro", "12"))
	if l := s.List(); len(l) != 2 {
		t.Fatalf("%+v", l)
	}
	s2, err := visor.OpenStore(path) // persiste
	if err != nil || len(s2.List()) != 2 {
		t.Fatalf("%v", err)
	}
}

// Puente completo: navegador (WebSocket local) → visor → servidor real por TLS.
func TestBridgeEndToEnd(t *testing.T) {
	cfg, _ := lanserver.ParseConfig([]byte(`{"name":"PC Puente"}`), "h")
	id, err := lanserver.LoadOrCreateIdentity(t.TempDir(), cfg.Name, 5911)
	if err != nil {
		t.Fatal(err)
	}
	ctrl := core.NewController(core.CaptureOptions{Interval: 50 * time.Millisecond}, false)
	ctrl.Consent = func(context.Context, string) bool { return true }
	ctrl.Capture = func() (*image.RGBA, error) {
		img := image.NewRGBA(image.Rect(0, 0, 32, 32))
		for i := 0; i < 32; i++ {
			img.Set(i, i, color.RGBA{255, 0, 0, 255})
		}
		return img, nil
	}
	ctrl.Size = func() (int, int, error) { return 32, 32, nil }
	srv := lanserver.New(cfg, id, ctrl)
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	sctx, scancel := context.WithCancel(context.Background())
	defer scancel()
	go srv.Serve(sctx, ln)

	app, _, host := newApp(t)
	if err := app.Store.Add(id.Pairing); err != nil {
		t.Fatal(err)
	}
	wsURL := "ws://" + host + "/ws?k=" + app.Token
	origin := http.Header{"Origin": {"http://" + host}}

	// Origin ajeno: rechazado
	if _, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": {"https://evil.example.com"}}); err == nil {
		t.Fatal("Origin ajeno debe rechazarse")
	}
	// sin token
	if _, _, err := websocket.DefaultDialer.Dial("ws://"+host+"/ws", origin); err == nil {
		t.Fatal("sin token debe rechazarse")
	}
	c, _, err := websocket.DefaultDialer.Dial(wsURL, origin)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.WriteJSON(map[string]string{"t": "connect", "addr": ln.Addr().String(), "pairing": id.Pairing.Fingerprint})
	var connected, consent, jpeg bool
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for !(connected && consent && jpeg) {
		mt, data, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("connected=%v consent=%v jpeg=%v: %v", connected, consent, jpeg, err)
		}
		if mt == websocket.BinaryMessage {
			jpeg = len(data) > 2 && data[0] == 0xFF && data[1] == 0xD8
			continue
		}
		var m map[string]any
		json.Unmarshal(data, &m)
		switch m["t"] {
		case "connected":
			connected = true
		case "consent":
			consent = m["ok"] == true
		}
	}
	// el navegador puede mandar input válido; lo inválido se descarta sin cortar
	c.WriteMessage(websocket.TextMessage, []byte(`{"t":"mouse","a":"move","x":0.2,"y":0.3}`))
	c.WriteMessage(websocket.TextMessage, []byte(`{"t":"mouse","a":"move","x":99,"y":0.3}`))
	c.WriteMessage(websocket.TextMessage, []byte(`{"t":"ping"}`))
}

func TestBridgeErrors(t *testing.T) {
	app, _, host := newApp(t)
	origin := http.Header{"Origin": {"http://" + host}}
	try := func(req map[string]string) string {
		c, _, err := websocket.DefaultDialer.Dial("ws://"+host+"/ws?k="+app.Token, origin)
		if err != nil {
			t.Fatal(err)
		}
		defer c.Close()
		c.WriteJSON(req)
		c.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, data, err := c.ReadMessage()
		if err != nil {
			return "cerrado"
		}
		var m map[string]string
		json.Unmarshal(data, &m)
		return m["error"]
	}
	if e := try(map[string]string{"t": "connect", "addr": "192.168.1.5:5911", "pairing": strings.Repeat("0", 64)}); !strings.Contains(e, "no está emparejado") {
		t.Errorf("sin pairing: %q", e)
	}
	good := proto.Pairing{Name: "X", Port: 5911, Secret: strings.Repeat("ab", 32), Fingerprint: strings.Repeat("cd", 32)}
	app.Store.Add(good)
	if e := try(map[string]string{"t": "connect", "addr": "8.8.8.8:5911", "pairing": good.Fingerprint}); !strings.Contains(e, "red local") {
		t.Errorf("IP pública: %q", e)
	}
}
