package visor

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"placer/remote-agent/internal/core"
	"placer/remote-agent/internal/proto"
)

//go:embed web/index.html web/logo-icon.svg
var webFS embed.FS

// App es el servidor web local del visor (solo 127.0.0.1).
type App struct {
	Token    string
	Port     int
	Store    *Store
	Disc     *Discovery
	Viewer   string // nombre que ve quien está en el equipo remoto
	hostsOK  map[string]bool
	upgrader websocket.Upgrader
}

func NewToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func NewApp(port int, store *Store, disc *Discovery, viewer string) *App {
	a := &App{Token: NewToken(), Port: port, Store: store, Disc: disc, Viewer: viewer}
	p := fmtInt(port)
	a.hostsOK = map[string]bool{"127.0.0.1:" + p: true, "localhost:" + p: true}
	a.upgrader = websocket.Upgrader{CheckOrigin: a.originOK, ReadBufferSize: 4096, WriteBufferSize: 64 * 1024}
	return a
}

func fmtInt(i int) string { return strconv.Itoa(i) }

// URL es la dirección (con el token de sesión) que se abre en el navegador.
func (a *App) URL() string { return "http://127.0.0.1:" + fmtInt(a.Port) + "/?k=" + a.Token }

func (a *App) originOK(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return false
	}
	u, err := url.Parse(o)
	return err == nil && u.Scheme == "http" && a.hostsOK[u.Host]
}

func isLoopback(remote string) bool {
	h, _, err := net.SplitHostPort(remote)
	if err != nil {
		return false
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func (a *App) tokenOK(r *http.Request) bool {
	t := r.Header.Get("X-Visor-Token")
	if t == "" {
		t = r.URL.Query().Get("k")
	}
	return subtle.ConstantTimeCompare([]byte(t), []byte(a.Token)) == 1
}

// guard: solo loopback, Host propio (anti DNS-rebinding) y token de sesión.
func (a *App) guard(needToken bool, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		if !isLoopback(r.RemoteAddr) || !a.hostsOK[r.Host] || (needToken && !a.tokenOK(r)) {
			http.Error(w, "no autorizado", http.StatusForbidden)
			return
		}
		// Si el navegador manda Origin (POST/DELETE/WS), tiene que ser el propio visor.
		if o := r.Header.Get("Origin"); o != "" && !a.originOK(r) {
			http.Error(w, "no autorizado", http.StatusForbidden)
			return
		}
		h(w, r)
	}
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/", a.guard(true, a.index))
	mux.HandleFunc("/logo-icon.svg", a.guard(false, a.logo))
	mux.HandleFunc("/api/state", a.guard(true, a.state))
	mux.HandleFunc("/api/pairings", a.guard(true, a.pairings))
	mux.HandleFunc("/ws", a.guard(true, a.ws))
	return mux
}

func (a *App) index(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	b, _ := webFS.ReadFile("web/index.html")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(b)
}

func (a *App) logo(w http.ResponseWriter, r *http.Request) {
	b, _ := webFS.ReadFile("web/logo-icon.svg")
	w.Header().Set("Content-Type", "image/svg+xml")
	w.Write(b)
}

type pairingView struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Port int    `json:"port"`
}

type peerView struct {
	Peer
	PairedID string `json:"pairedId"`
}

func (a *App) state(w http.ResponseWriter, r *http.Request) {
	ps := a.Store.List()
	pv := make([]pairingView, 0, len(ps))
	for _, p := range ps {
		pv = append(pv, pairingView{ID: p.Fingerprint, Name: p.Name, Port: p.Port})
	}
	peers := []peerView{}
	for _, pe := range a.Disc.List() {
		v := peerView{Peer: pe}
		for _, p := range ps {
			if strings.EqualFold(p.Name, pe.Name) && p.Port == pe.Port {
				v.PairedID = p.Fingerprint
				break
			}
		}
		peers = append(peers, v)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"peers": peers, "pairings": pv, "viewer": a.Viewer})
}

func (a *App) pairings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodPost:
		body, _ := io.ReadAll(io.LimitReader(r.Body, 8192))
		p, err := proto.ParsePairing(body)
		if err == nil {
			err = a.Store.Add(p)
		}
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"ok": "1", "name": p.Name})
	case http.MethodDelete:
		if err := a.Store.Remove(r.URL.Query().Get("id")); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"ok": "1"})
	default:
		http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
	}
}

// Mensajes del servidor que se reenvían tal cual al navegador (lista blanca).
var forwardTypes = map[string]bool{"waiting_consent": true, "consent": true, "info": true, "error": true}

const browserIdle = 90 * time.Second

func (a *App) ws(w http.ResponseWriter, r *http.Request) {
	bc, err := a.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer bc.Close()
	bc.SetReadLimit(proto.MaxControlBytes)
	var bmu sync.Mutex
	bsend := func(typ int, b []byte) error {
		bmu.Lock()
		defer bmu.Unlock()
		bc.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return bc.WriteMessage(typ, b)
	}
	sendErr := func(msg string) { bsend(websocket.TextMessage, proto.ErrorMsg(msg)) }

	// Primer mensaje: qué equipo y con qué emparejamiento. Sin contraseñas.
	bc.SetReadDeadline(time.Now().Add(15 * time.Second))
	_, first, err := bc.ReadMessage()
	if err != nil {
		return
	}
	var req struct {
		T       string `json:"t"`
		Pairing string `json:"pairing"`
		Addr    string `json:"addr"`
	}
	if json.Unmarshal(first, &req) != nil || req.T != "connect" {
		sendErr("solicitud inválida")
		return
	}
	pairing, ok := a.Store.Get(req.Pairing)
	if !ok {
		sendErr("Ese equipo no está emparejado. Importa su archivo pairing.json.")
		return
	}
	ap, err := ParseLANAddr(req.Addr)
	if err != nil {
		sendErr(err.Error())
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	remote, err := Dial(ctx, ap, pairing, a.Viewer)
	if err != nil {
		core.Logf("Conexión a %s falló: %v", ap, err)
		sendErr(err.Error())
		return
	}
	defer remote.Conn.Close()
	core.Logf("Conectado a «%s» (%s).", remote.Name, ap)
	bsend(websocket.TextMessage, []byte(`{"t":"connected"}`))

	done := make(chan struct{})
	var once sync.Once
	stop := func() { once.Do(func() { close(done); cancel(); remote.Conn.Close(); bc.Close() }) }
	defer stop()

	// servidor → navegador
	go func() {
		defer stop()
		for {
			remote.Conn.SetReadDeadline(time.Now().Add(IdleRemote))
			typ, data, err := proto.ReadFrame(remote.Conn, proto.MaxMediaFrame)
			if err != nil {
				return
			}
			if typ == proto.FrameBinary {
				if len(data) < 2 || data[0] != 0xFF || data[1] != 0xD8 { // solo JPEG
					continue
				}
				if bsend(websocket.BinaryMessage, data) != nil {
					return
				}
				continue
			}
			var t struct {
				T string `json:"t"`
			}
			if json.Unmarshal(data, &t) == nil && forwardTypes[t.T] {
				if bsend(websocket.TextMessage, data) != nil {
					return
				}
			}
		}
	}()
	// navegador → servidor (solo mensajes válidos)
	for {
		bc.SetReadDeadline(time.Now().Add(browserIdle))
		mt, data, err := bc.ReadMessage()
		if err != nil {
			return
		}
		if mt != websocket.TextMessage {
			continue
		}
		if _, err := proto.ParseViewerMsg(data); err != nil {
			continue
		}
		remote.Conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		if proto.WriteFrame(remote.Conn, proto.FrameText, data) != nil {
			return
		}
	}
}

// IdleRemote: tiempo máximo sin recibir nada del servidor.
var IdleRemote = 5 * time.Minute

// Run sirve la página hasta que ctx termine. ln debe ser de 127.0.0.1.
func (a *App) Run(ctx context.Context, ln net.Listener) error {
	srv := &http.Server{Handler: a.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() { <-ctx.Done(); srv.Close() }()
	err := srv.Serve(ln)
	if ctx.Err() != nil {
		return nil
	}
	return err
}
